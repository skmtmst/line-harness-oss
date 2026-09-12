import { beginHqTemplateDistributionRun, beginHqTemplateStoreResult, normalizeScopedTagName, type HqTemplateDistributionResult, type HqTemplatePreflight, type HqTemplatePreflightResolution, type HqTemplateStatement } from '@line-crm/db';
import { requireHqTemplateAuthority, type HqTemplateAdapterContext, type HqTemplateAdapterInput, type HqTemplateAdapterResult, type HqTemplateAuthority, type HqTemplateStoreAtomicCommitPlan } from './contract.js';
import { createFormHqTemplateAdapter, type FormTemplateDependencies } from './form.js';

export class HqRuntimeError extends Error {
  constructor(public readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new HqRuntimeError(code); };
const guard = (condition: string, bindings: HqTemplateStatement['bindings']): HqTemplateStatement => ({ sql: `SELECT json(CASE WHEN (${condition}) THEN '{}' ELSE 'HQ_RUNTIME_CONFLICT' END)`, bindings });
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
const ok = <T>(r: HqTemplateAdapterResult<T>): T => r.kind === 'OK' ? r.value : fail('UNSUPPORTED');

type DbRow = Record<string, string | number | null>;
function insertRow(table: 'scenarios' | 'scenario_steps', row: DbRow): HqTemplateStatement {
  const columns = Object.keys(row);
  return { sql: `INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, bindings: columns.map(column => row[column]) };
}
function exactRowGuard(table: 'scenarios' | 'scenario_steps', row: DbRow): HqTemplateStatement {
  const columns = Object.keys(row);
  return guard(`EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(column => `${column} IS ?`).join(' AND ')})`, columns.map(column => row[column]));
}
function hasPortableTextReference(value: unknown): boolean {
  let current = String(value ?? '');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (/(?:liff\.line\.me|[?&#](?:form|template|scenario|tag|(?:line)?account)(?:s|ids?)?=|\/(?:forms?|scenarios?|templates?|tags?|accounts?)\/)/i.test(current)) return true;
    if (!/%[0-9a-f]{2}/i.test(current)) return false;
    try {
      const next = decodeURIComponent(current);
      if (next === current) return false;
      current = next;
    } catch { return true; }
  }
  return /%[0-9a-f]{2}/i.test(current);
}

/** Store-scoped planner: never writes; all reference creation joins the form batch. */
export function createFormReferenceResolver({ db, authority }: { db: D1Database; authority: HqTemplateAuthority }): FormTemplateDependencies['resolveReference'] {
  const planned = new Map<string, { targetId: string; statement: HqTemplateStatement }>();
  const plannedScenarios = new Map<string, { targetId: string; statements: HqTemplateStatement[] }>();
  return async (reference, context) => {
    if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED' || context.tenantId !== authority.tenantId) fail('FORBIDDEN');
    if (reference.kind === 'scenario') {
      const source = await db.prepare(`SELECT s.* FROM scenarios s JOIN line_accounts a ON a.id=s.line_account_id WHERE s.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(reference.sourceId, authority.tenantId).first<DbRow>();
      if (!source) fail('REFERENCE_UNAVAILABLE');
      const safeSource = source!;
      if (safeSource.trigger_type !== 'manual' || safeSource.on_complete_mode !== 'pause' || safeSource.trigger_tag_id || safeSource.on_complete_scenario_id || safeSource.folder_id || safeSource.audience_condition_json) fail('UNSUPPORTED_REFERENCE');
      const target = await db.prepare(`SELECT id FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL`).bind(context.targetAccountId, authority.tenantId).first();
      if (!target) fail('FORBIDDEN');
      const steps = (await db.prepare(`SELECT * FROM scenario_steps WHERE scenario_id=? ORDER BY step_order,id`).bind(reference.sourceId).all<DbRow>()).results;
      const hasActions = await db.prepare(`SELECT 1 AS present FROM scenario_actions WHERE scenario_id=? LIMIT 1`).bind(reference.sourceId).first();
      const hasTriggers = await db.prepare(`SELECT 1 AS present FROM scenario_triggers WHERE scenario_id=? LIMIT 1`).bind(reference.sourceId).first();
      if (hasActions || hasTriggers || steps.some(step => step.template_id || step.on_reach_tag_id || step.message_bubbles_json || step.target_condition_json || step.question_json || step.condition_type || step.condition_value || step.message_type !== 'text' || hasPortableTextReference(step.message_content))) fail('UNSUPPORTED_REFERENCE');
      const matches = (await db.prepare(`SELECT id,name FROM scenarios WHERE line_account_id=? ORDER BY id`).bind(context.targetAccountId).all<{ id: string; name: string }>()).results.filter(row => normalizeScopedTagName(row.name) === normalizeScopedTagName(String(safeSource.name)));
      if (matches.length > 1) fail('REFERENCE_UNAVAILABLE');
      if (matches.length === 1) {
        if (String(safeSource.line_account_id) !== context.targetAccountId || matches[0].id !== reference.sourceId) fail('REFERENCE_UNAVAILABLE');
        return { targetId: matches[0].id, dbCommit: [exactRowGuard('scenarios', safeSource), guard(`(SELECT COUNT(*) FROM scenario_steps WHERE scenario_id=?)=?`, [reference.sourceId, steps.length]), ...steps.map(step => exactRowGuard('scenario_steps', step)), guard(`NOT EXISTS(SELECT 1 FROM scenario_actions WHERE scenario_id=?) AND NOT EXISTS(SELECT 1 FROM scenario_triggers WHERE scenario_id=?)`, [reference.sourceId, reference.sourceId])] };
      }
      const cacheKey = JSON.stringify([context.targetAccountId, normalizeScopedTagName(String(safeSource.name))]);
      let created = plannedScenarios.get(cacheKey);
      if (!created) {
        const targetId = crypto.randomUUID();
        const statements: HqTemplateStatement[] = [
          exactRowGuard('scenarios', safeSource),
          guard(`(SELECT COUNT(*) FROM scenario_steps WHERE scenario_id=?)=?`, [reference.sourceId, steps.length]),
          guard(`NOT EXISTS(SELECT 1 FROM scenario_actions WHERE scenario_id=?) AND NOT EXISTS(SELECT 1 FROM scenario_triggers WHERE scenario_id=?)`, [reference.sourceId, reference.sourceId]),
        ];
        for (const step of steps) statements.push(exactRowGuard('scenario_steps', step));
        const scenario: DbRow = { ...safeSource, id: targetId, line_account_id: context.targetAccountId, is_active: 0, folder_id: null, created_from_recipe_id: null, recipe_clone_run_id: null, current_published_version_id: null };
        delete scenario.created_at; delete scenario.updated_at;
        statements.push(insertRow('scenarios', scenario));
        for (const step of steps) {
          const cloned: DbRow = { ...step, id: crypto.randomUUID(), scenario_id: targetId, is_draft: 1 };
          delete cloned.created_at;
          statements.push(insertRow('scenario_steps', cloned));
        }
        created = { targetId, statements };
        plannedScenarios.set(cacheKey, created);
      }
      return { targetId: created.targetId, dbCommit: created.statements };
    }
    if (reference.kind !== 'tag') fail('UNSUPPORTED_REFERENCE');
    const source = await db.prepare(`SELECT t.id,t.name,t.color,t.description,t.version,t.updated_at,t.line_account_id FROM tags t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND t.status='active' AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(reference.sourceId, authority.tenantId).first<{ id: string; name: string; color: string; description: string | null; version: number; updated_at: string | null; line_account_id: string }>();
    if (!source) fail('REFERENCE_UNAVAILABLE');
    const target = await db.prepare(`SELECT id FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL`).bind(context.targetAccountId, authority.tenantId).first();
    if (!target) fail('FORBIDDEN');
    const sourceGuard = guard(`EXISTS(SELECT 1 FROM tags t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND t.line_account_id=? AND t.name=? AND t.color IS ? AND t.description IS ? AND t.version=? AND t.updated_at IS ? AND t.status='active' AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL)`, [source!.id, source!.line_account_id, source!.name, source!.color, source!.description, source!.version, source!.updated_at, authority.tenantId]);
    const name = normalizeScopedTagName(source!.name);
    const rows = (await db.prepare(`SELECT id,name,status FROM tags WHERE line_account_id=? ORDER BY id`).bind(context.targetAccountId).all<{ id: string; name: string; status: string }>()).results;
    const matches = rows.filter(row => normalizeScopedTagName(row.name) === name);
    if (matches.length > 1 || matches.some(row => row.status !== 'active')) fail('REFERENCE_UNAVAILABLE');
    if (matches.length === 1) return { targetId: matches[0].id, dbCommit: [sourceGuard] };
    const cacheKey = JSON.stringify([context.targetAccountId, name]);
    let created = planned.get(cacheKey);
    if (!created) {
      const targetId = crypto.randomUUID();
      created = { targetId, statement: { sql: `INSERT INTO tags(id,name,normalized_name,color,description,line_account_id,created_by,updated_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM tags WHERE id=?)`, bindings: [targetId, source!.name, name, source!.color, source!.description, context.targetAccountId, authority.actorId, authority.actorId, targetId] } };
      planned.set(cacheKey, created);
    }
    return { targetId: created.targetId, dbCommit: [sourceGuard, created.statement] };
  };
}
export const createFormTagReferenceResolver = createFormReferenceResolver;

export async function buildFormRuntimePlan({ db, authority, input, context }: { db: D1Database; authority: HqTemplateAuthority; input: HqTemplateAdapterInput; context: HqTemplateAdapterContext }): Promise<HqTemplateStoreAtomicCommitPlan> {
  const adapter = createFormHqTemplateAdapter({ db, authority, resolveReference: createFormReferenceResolver({ db, authority }) });
  const refs = ok(await adapter.extractReferences(input));
  const verified = ok(await adapter.verifyReferences(context, refs));
  const duplicates = ok(await adapter.detectDuplicates(context, verified));
  const ids = ok(await adapter.buildIdMap(context, verified, duplicates));
  return ok(await adapter.buildCommitPlan(context, input, ids));
}

export interface AtomicStoreOptions {
  db: D1Database;
  authority: HqTemplateAuthority;
  templateId: string;
  runId: string;
  context: HqTemplateAdapterContext;
  /** Trusted server planner only. Never pass SQL or this callback from request JSON. */
  buildPlan: (context: HqTemplateAdapterContext, input: HqTemplateAdapterInput) => Promise<HqTemplateStoreAtomicCommitPlan>;
}
export type AtomicStoreOutcome = { status: HqTemplateDistributionResult['status']; reused: boolean };

/** No R2, takeover, or automatic retry. An interrupted staged claim needs reconciliation. */
export async function executeHqAtomicStore(options: AtomicStoreOptions): Promise<AtomicStoreOutcome> {
  const { db, authority, templateId, runId } = options;
  if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED' || options.context.tenantId !== authority.tenantId) fail('FORBIDDEN');
  const p = await db.prepare(`SELECT p.* FROM hq_template_preflights p JOIN hq_templates t ON t.id=p.template_id AND t.tenant_id=p.tenant_id JOIN line_accounts a ON a.id=p.target_account_id AND a.tenant_id=p.tenant_id WHERE p.id=? AND p.tenant_id=? AND p.template_id=? AND p.created_by=? AND t.template_type='form' AND t.archived_at IS NULL AND a.is_active=1 AND a.archived_at IS NULL`).bind(options.context.preflightId, authority.tenantId, templateId, authority.actorId).first<HqTemplatePreflight>();
  if (!p || p.target_account_id !== options.context.targetAccountId || p.idempotency_fingerprint !== runId || options.context.idempotencyFingerprint !== runId || p.snapshot_token !== options.context.snapshotToken) fail('INVALID_PREFLIGHT');
  const rows = (await db.prepare(`SELECT * FROM hq_template_preflight_resolutions WHERE preflight_id=? AND tenant_id=? ORDER BY source_id`).bind(p!.id, authority.tenantId).all<HqTemplatePreflightResolution>()).results;
  if (!rows.length || rows.length !== options.context.resolutions.length || new Set(options.context.resolutions.map(r => r.sourceId)).size !== rows.length) fail('SELECTION_REQUIRED');
  const resolutions = rows.map(row => {
    const selected = options.context.resolutions.find(r => r.sourceId === row.source_id);
    if (!selected || selected.itemKind !== row.item_kind || !['create', 'overwrite', 'alias'].includes(selected.mode) || (selected.targetId !== undefined && selected.targetId !== row.target_id) || (selected.expectedRevision !== undefined && selected.expectedRevision !== row.expected_revision)) fail('SELECTION_REQUIRED');
    return { sourceId: row.source_id, itemKind: row.item_kind, mode: selected!.mode, targetId: row.target_id ?? undefined, expectedRevision: row.expected_revision ?? undefined };
  });
  if (!['create', 'overwrite', 'alias'].includes(options.context.mode)) fail('SELECTION_REQUIRED');
  const context = { ...options.context, resolutions };
  const version = await db.prepare(`SELECT definition_json FROM hq_template_versions WHERE id=? AND template_id=? AND tenant_id=?`).bind(p!.template_version_id, templateId, authority.tenantId).first<{ definition_json: string }>();
  if (!version) fail('VERSION_CONFLICT');
  const input = { templateVersionId: p!.template_version_id, definitionJson: version!.definition_json };
  const read = async () => db.prepare(`SELECT * FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?`).bind(runId, authority.tenantId, context.targetAccountId).first<HqTemplateDistributionResult>();
  const sourceId = JSON.stringify([authority.tenantId, runId, context.targetAccountId]);
  const requestHash = await hash(JSON.stringify([templateId, p!.template_version_id, p!.snapshot_token, context.mode, resolutions.map(r => [r.sourceId, r.itemKind, r.mode])]));
  const checkReceipt = async () => {
    const receipt = await db.prepare(`SELECT after_json,actor_principal_id FROM audit_events WHERE source_kind='hq_template_store_request' AND source_id=? AND tenant_id=?`).bind(sourceId, authority.tenantId).first<{ after_json: string; actor_principal_id: string }>();
    if (!receipt || receipt.actor_principal_id !== authority.actorId || receipt.after_json !== JSON.stringify({ requestHash })) fail('SELECTION_CHANGED');
  };
  const previous = await read();
  if (previous && (previous.template_id !== templateId || previous.template_version_id !== p!.template_version_id || previous.preflight_id !== p!.id || previous.snapshot_token !== p!.snapshot_token || previous.idempotency_fingerprint !== runId)) fail('INVALID_PREFLIGHT');
  if (previous) { await checkReceipt(); if (previous.status !== 'pending') return { status: previous.status, reused: true }; }
  if (!p!.expires_at || !Number.isFinite(Date.parse(p!.expires_at)) || Date.parse(p!.expires_at) <= Date.now()) fail('VERSION_CONFLICT');
  const run = await beginHqTemplateDistributionRun(db, { id: runId, tenantId: authority.tenantId, templateId, templateVersionId: p!.template_version_id, idempotencyFingerprint: runId, createdBy: authority.actorId });
  if (run.run.status !== 'running' || run.run.created_by !== authority.actorId) fail('INVALID_RUN');
  // Write receipt before the first claim, so even a crash in pending binds the decision.
  await db.prepare(`INSERT OR IGNORE INTO audit_events(id,source_kind,source_id,tenant_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,'hq_template_store_request',?,?,'business',?,?,'hq_template.store_requested','hq_template',?,'success',?)`).bind(crypto.randomUUID(), sourceId, authority.tenantId, authority.actorId, authority.role, templateId, JSON.stringify({ requestHash })).run();
  await checkReceipt();
  const begun = await beginHqTemplateStoreResult(db, { runId, tenantId: authority.tenantId, templateId, templateVersionId: p!.template_version_id, targetAccountId: context.targetAccountId, preflightId: p!.id, idempotencyFingerprint: runId, snapshotToken: p!.snapshot_token });
  if (begun.kind === 'conflict_or_missing') fail('INVALID_PREFLIGHT');
  const claimed = await db.prepare(`UPDATE hq_template_distribution_results SET status='staged',attempt_count=attempt_count+1 WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='pending'`).bind(runId, authority.tenantId, context.targetAccountId).run();
  if (claimed.meta.changes !== 1) { const row = await read(); if (!row) fail('RESULT_UNAVAILABLE'); return { status: row!.status, reused: true }; }
  const claimedRow = await read();
  if (!claimedRow || claimedRow.status !== 'staged') fail('RESULT_UNAVAILABLE');
  const attempt = claimedRow!.attempt_count;
  const claimCondition = `EXISTS(SELECT 1 FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?)`;
  const claimBindings = [runId, authority.tenantId, context.targetAccountId, attempt];
  let batchStarted = false;
  try {
    const plan = await options.buildPlan(context, input);
    if (plan.stage.length || plan.compensateOnDbFailure.length || plan.reconcile.length) fail('UNSUPPORTED_R2');
    if (plan.tenantId !== authority.tenantId || plan.targetAccountId !== context.targetAccountId || plan.preflightId !== p!.id || plan.idempotencyFingerprint !== runId || plan.snapshotToken !== p!.snapshot_token || plan.mode !== context.mode || JSON.stringify(plan.resolutions.map(r => [r.sourceId, r.itemKind, r.mode]).sort()) !== JSON.stringify(resolutions.map(r => [r.sourceId, r.itemKind, r.mode]).sort())) fail('INVALID_PLAN');
    const statements: HqTemplateStatement[] = [guard(claimCondition, claimBindings), guard(`EXISTS(SELECT 1 FROM hq_template_preflights WHERE id=? AND tenant_id=? AND status='consumed' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, [p!.id, authority.tenantId]), guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL)`, [context.targetAccountId, authority.tenantId]), guard(`EXISTS(SELECT 1 FROM hq_template_versions v JOIN hq_templates t ON t.id=v.template_id AND t.tenant_id=v.tenant_id WHERE v.id=? AND v.tenant_id=? AND v.template_id=? AND v.definition_json=? AND t.archived_at IS NULL)`, [input.templateVersionId, authority.tenantId, templateId, input.definitionJson]), guard(`EXISTS(SELECT 1 FROM hq_template_distribution_runs WHERE id=? AND tenant_id=? AND status='running' AND created_by=?)`, [runId, authority.tenantId, authority.actorId]), ...plan.dbCommit];
    for (const r of plan.resolutions) statements.push({ sql: `UPDATE hq_template_preflight_resolutions SET resolution_mode=?,target_id=?,expected_revision=?,alias_name=? WHERE preflight_id=? AND tenant_id=? AND source_id=?`, bindings: [r.mode, r.targetId ?? null, r.expectedRevision ?? null, r.aliasName ?? null, p!.id, authority.tenantId, r.sourceId] });
    statements.push({ sql: `UPDATE hq_template_distribution_results SET status='succeeded',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),error_code=NULL WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?`, bindings: claimBindings }, { sql: `INSERT INTO audit_events(id,tenant_id,line_account_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,?,?,'business',?,?,'hq_template.distributed','hq_template',?,'success',?)`, bindings: [crypto.randomUUID(), authority.tenantId, context.targetAccountId, authority.actorId, authority.role, templateId, JSON.stringify({ runId })] });
    batchStarted = true;
    await db.batch(statements.map(s => db.prepare(s.sql).bind(...s.bindings)));
    return { status: 'succeeded', reused: false };
  } catch (error) {
    // A successful batch may lose its response. Never replay the business writes.
    const row = await read().catch(() => null);
    if (!row) fail('RESULT_UNAVAILABLE');
    if (row!.status !== 'staged' || row!.attempt_count !== attempt) return { status: row!.status, reused: true };
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    // A thrown batch is not proof of rollback. Keep unknown database outcomes staged.
    if (batchStarted || !code) return { status: 'staged', reused: false };
    const status = code.includes('UNSUPPORTED') ? 'unsupported' : code === 'VERSION_CONFLICT' ? 'version_conflict' : 'failed';
    await db.prepare(`UPDATE hq_template_distribution_results SET status=?,error_code=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?`).bind(status, status === 'unsupported' ? 'UNSUPPORTED_REFERENCE' : status === 'version_conflict' ? 'VERSION_CONFLICT' : 'STORE_PLAN_FAILED', ...claimBindings).run();
    return { status, reused: false };
  }
}

export async function executeFormStore(options: Omit<AtomicStoreOptions, 'buildPlan'>): Promise<AtomicStoreOutcome> {
  return executeHqAtomicStore({ ...options, buildPlan: (context, input) => buildFormRuntimePlan({ db: options.db, authority: options.authority, context, input }) });
}
