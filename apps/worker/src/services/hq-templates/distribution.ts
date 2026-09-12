import {
  beginHqTemplateDistributionRun, getHqTemplate, listHqTemplates, HQ_TEMPLATE_TYPES,
  type HqTemplate, type HqTemplatePreflight, type HqTemplatePreflightResolution,
  type HqTemplateDistributionResult, type HqTemplateStatement, type HqTemplateType,
} from '@line-crm/db';
import { type HqTemplateAuthority, type HqTemplateResolution, type HqTemplateAdapterResult, type HqTemplateSnapshotToken, VERSION_CONFLICT_MESSAGE } from './contract.js';
import { getHqTemplateAdapter } from './registry.js';
import { boundedText, HqTemplateError, inspectTags, parseTagDefinition, planTags, tagSnapshot } from './tag.js';
import { parseMessageTemplateDefinition } from './template.js';
import { inspectFormTemplate, parseFormTemplateDefinition } from './form.js';
import { parseRichMenuTemplateDefinition } from './rich-menu.js';
import { executeFormStore, HqRuntimeError } from './runtime.js';
import { executeR2RuntimeStore, HqR2RuntimeError, inspectR2RuntimeStore } from './runtime-r2.js';

export { HqTemplateError } from './tag.js';
export type DistributionSelection = { accountId: string; sourceId: string; mode: 'create' | 'overwrite' | 'alias' };
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
function guard(sql: string, bindings: HqTemplateStatement['bindings']): HqTemplateStatement {
  return { sql: `SELECT json(CASE WHEN (${sql}) THEN '{}' ELSE 'HQ_GUARD_FAILED' END)`, bindings };
}
async function batch(db: D1Database, statements: HqTemplateStatement[]) {
  return db.batch(statements.map(s => db.prepare(s.sql).bind(...s.bindings)));
}
function audit(authority: HqTemplateAuthority, action: string, targetId: string, accountId: string | null = null, result = 'success', runId: string | null = null): HqTemplateStatement {
  return { sql: `INSERT INTO audit_events(id,tenant_id,line_account_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,?,?,'business',?, ?,?,'hq_template',?,?,?)`,
    bindings: [crypto.randomUUID(), authority.tenantId, accountId, authority.actorId, authority.role, `hq_template.${action}`, targetId, result, runId ? JSON.stringify({ runId }) : null] };
}
export async function listTemplateAccounts(db: D1Database, authority: HqTemplateAuthority) {
  return (await db.prepare(`SELECT id,name FROM line_accounts WHERE tenant_id=? AND is_active=1 AND archived_at IS NULL ORDER BY name,id`).bind(authority.tenantId).all<{ id: string; name: string }>()).results;
}
export async function requireTargetAccounts(db: D1Database, authority: HqTemplateAuthority, ids: string[]) {
  if (!ids.length || ids.length > 30 || new Set(ids).size !== ids.length) throw new HqTemplateError('INVALID_ACCOUNTS');
  const allowed = await listTemplateAccounts(db, authority);
  if (ids.some(id => !allowed.some(a => a.id === id))) throw new HqTemplateError('FORBIDDEN', 403);
  return ids.map(id => allowed.find(a => a.id === id)!);
}
export async function templateDetail(db: D1Database, authority: HqTemplateAuthority, id: string) {
  const template = await getHqTemplate(db, authority.tenantId, id);
  if (!template || template.archived_at) throw new HqTemplateError('NOT_FOUND', 404);
  const version = await db.prepare(`SELECT definition_json FROM hq_template_versions WHERE tenant_id=? AND template_id=? AND id=?`)
    .bind(authority.tenantId, id, template.current_version_id).first<{ definition_json: string }>();
  if (!version) throw new HqTemplateError('VERSION_UNAVAILABLE', 409);
  return { template, definition: JSON.parse(version.definition_json) as unknown };
}
/** Client creation keys are tenant-scoped; the receipt namespace never overlaps health operations. */
export function templateCreationRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new HqTemplateError('INVALID_REQUEST_ID');
  return value;
}
function canonicalCreationBody(body: Record<string, unknown>): string {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,v]) => [key,stable(v)])) : value;
  return JSON.stringify(stable(Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'requestId'))));
}
async function replayTemplateCreation(db: D1Database, authority: HqTemplateAuthority, key: string, requestHash: string, templateId: string, name: string, description: string | null) {
  const receipt = await db.prepare(`SELECT request_hash,resource_id FROM operation_request_receipts WHERE action='hq_template.create' AND actor_id=? AND idempotency_key=?`).bind(`tenant:${authority.tenantId}`, key).first<{ request_hash: string; resource_id: string }>();
  if (!receipt) return null;
  if (receipt.request_hash !== requestHash) throw new HqTemplateError('IDEMPOTENCY_CONFLICT', 409);
  if (receipt.resource_id !== templateId) throw new HqTemplateError('CREATE_RECEIPT_UNAVAILABLE', 409);
  const initial = await db.prepare(`SELECT t.template_type,t.created_at AS template_created_at,v.id,v.created_at,v.created_by,v.definition_json FROM hq_templates t JOIN hq_template_versions v ON v.tenant_id=t.tenant_id AND v.template_id=t.id AND v.version=1 WHERE t.id=? AND t.tenant_id=?`).bind(templateId, authority.tenantId).first<{ template_type:HqTemplateType; template_created_at:string; id:string; created_at:string; created_by:string|null; definition_json:string }>();
  if (!initial) throw new HqTemplateError('CREATE_RECEIPT_UNAVAILABLE', 409);
  // Return the original creation response, even if the live record was later edited/archived.
  return { template: { id: templateId, tenant_id: authority.tenantId, template_type: initial.template_type, name, description, current_version_id: initial.id, revision: 2, created_by: initial.created_by, created_at: initial.template_created_at, updated_at: initial.created_at, archived_at: null }, definition: JSON.parse(initial.definition_json) as unknown };
}
function canonicalDefinition(type: HqTemplateType, value: unknown, authority: HqTemplateAuthority): unknown {
  try {
    if (type === 'tag') return parseTagDefinition(value);
    if (type === 'template') return parseMessageTemplateDefinition(value);
    const input = { templateVersionId: 'validation', definitionJson: JSON.stringify(value) };
    if (type === 'rich_menu') return parseRichMenuTemplateDefinition(input, authority.tenantId);
    return parseFormTemplateDefinition(input);
  } catch (error) {
    if (error instanceof HqTemplateError) throw error;
    throw new HqTemplateError('INVALID_DEFINITION');
  }
}
export async function saveTemplate(db: D1Database, authority: HqTemplateAuthority, body: Record<string, unknown>, id?: string) {
  const requestId = id ? null : templateCreationRequestId(body.requestId);
  const requestHash = await digest(canonicalCreationBody(body));
  if (requestId) {
    const receipt = await db.prepare(`SELECT request_hash FROM operation_request_receipts WHERE action='hq_template.create' AND actor_id=? AND idempotency_key=?`).bind(`tenant:${authority.tenantId}`,requestId).first<{ request_hash:string }>();
    if (receipt && receipt.request_hash !== requestHash) throw new HqTemplateError('IDEMPOTENCY_CONFLICT',409);
  }
  const current = id ? await templateDetail(db, authority, id) : null;
  const type = current?.template.template_type ?? body.type;
  if (!HQ_TEMPLATE_TYPES.includes(type as HqTemplateType) || (body.type !== undefined && body.type !== type)) throw new HqTemplateError('INVALID_TYPE');
  const definition = canonicalDefinition(type as HqTemplateType, body.definition, authority), json = JSON.stringify(definition);
  const name = boundedText(body.name), description = body.description == null || body.description === '' ? null : boundedText(body.description, 2000);
  const templateId = id ?? `hqt_${await digest(JSON.stringify([authority.tenantId, requestId]))}`;
  const versionId = crypto.randomUUID(), revision = current?.template.revision ?? 0, createdAt = new Date().toISOString();
  if (requestId) {
    const replay = await replayTemplateCreation(db, authority, requestId, requestHash, templateId, name, description);
    if (replay) return replay;
  }
  if (id && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== revision)) throw new HqTemplateError('VERSION_CONFLICT', 409);
  const statements: HqTemplateStatement[] = [];
  if (current) statements.push(guard(`EXISTS(SELECT 1 FROM hq_templates WHERE id=? AND tenant_id=? AND revision=? AND archived_at IS NULL)`, [id!, authority.tenantId, revision]));
  else statements.push(
    { sql: `INSERT INTO operation_request_receipts(action,actor_id,idempotency_key,request_hash,resource_id,created_at) VALUES ('hq_template.create',?,?,?,?,?)`, bindings: [`tenant:${authority.tenantId}`, requestId!, requestHash, templateId, createdAt] },
    { sql: `INSERT INTO hq_templates(id,tenant_id,template_type,name,description,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, bindings: [templateId, authority.tenantId, type as HqTemplateType, name, description, authority.actorId, createdAt, createdAt] });
  statements.push({ sql: `INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash,created_by,created_at) VALUES (?,?,?,(SELECT COALESCE(MAX(version),0)+1 FROM hq_template_versions WHERE tenant_id=? AND template_id=?),?,?,?,?)`, bindings: [versionId, authority.tenantId, templateId, authority.tenantId, templateId, json, await digest(json), authority.actorId, createdAt] });
  statements.push({ sql: `UPDATE hq_templates SET name=?,description=?,current_version_id=?,revision=revision+1,updated_at=? WHERE id=? AND tenant_id=?`, bindings: [name, description, versionId, createdAt, templateId, authority.tenantId] }, audit(authority, current ? 'edited' : 'created', templateId));
  try { await batch(db, statements); }
  catch {
    if (requestId) {
      const replay = await replayTemplateCreation(db, authority, requestId, requestHash, templateId, name, description);
      if (replay) return replay;
      // Even an operator-deleted receipt cannot make the same key create a second resource.
      if (await getHqTemplate(db, authority.tenantId, templateId)) throw new HqTemplateError('CREATE_RECEIPT_UNAVAILABLE', 409);
      throw new HqTemplateError('CREATE_UNAVAILABLE', 500);
    }
    throw new HqTemplateError('VERSION_CONFLICT', 409);
  }
  return requestId ? (await replayTemplateCreation(db, authority, requestId, requestHash, templateId, name, description))! : templateDetail(db, authority, templateId);
}
export async function deleteTemplate(db: D1Database, authority: HqTemplateAuthority, id: string, revision: unknown) {
  if (!Number.isSafeInteger(revision)) throw new HqTemplateError('INVALID_REVISION');
  await templateDetail(db, authority, id);
  try {
    await batch(db, [guard(`EXISTS(SELECT 1 FROM hq_templates WHERE id=? AND tenant_id=? AND revision=? AND archived_at IS NULL)`, [id, authority.tenantId, revision as number]),
      { sql: `UPDATE hq_templates SET archived_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1 WHERE id=? AND tenant_id=?`, bindings: [id, authority.tenantId] }, audit(authority, 'deleted', id)]);
  } catch { throw new HqTemplateError('VERSION_CONFLICT', 409); }
  return { id, archived: true };
}
export async function listTemplates(db: D1Database, authority: HqTemplateAuthority, type?: HqTemplateType): Promise<HqTemplate[]> {
  return listHqTemplates(db, authority.tenantId, type);
}
export async function preflightDistribution(db: D1Database, authority: HqTemplateAuthority, id: string, accountIds: string[], bucket?: R2Bucket) {
  const accounts = await requireTargetAccounts(db, authority, accountIds);
  const { template, definition } = await templateDetail(db, authority, id);
  const input = { templateVersionId: template.current_version_id!, definitionJson: JSON.stringify(definition) };
  const tagDefinition = template.template_type === 'tag' ? parseTagDefinition(definition) : null;
  const preflightId = crypto.randomUUID(), expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const statements: HqTemplateStatement[] = [], stores = [];
  for (const account of accounts) {
    const snapshot = tagDefinition ? await tagSnapshot(db, account.id) : null;
    const form = template.template_type === 'form' ? await inspectFormTemplate(db, authority, account.id, input) : null;
    let r2: Awaited<ReturnType<typeof inspectR2RuntimeStore>> | null = null;
    if (template.template_type === 'template' || template.template_type === 'rich_menu') {
      if (!bucket) throw new HqTemplateError('UNSUPPORTED', 422);
      try { r2 = await inspectR2RuntimeStore({ db, bucket, authority, templateId: id, templateVersionId: template.current_version_id! }, account.id); }
      catch (error) { rethrowR2(error); }
    }
    const items = tagDefinition ? inspectTags(tagDefinition, snapshot!) : form
      ? [{ sourceId: form.sourceId, itemKind: form.itemKind, name: form.name, targetId: form.targetId, expectedRevision: form.expectedRevision, duplicate: form.duplicate, allowedModes: [...form.allowedModes] }]
      : r2!.items;
    const storeId = crypto.randomUUID(), token = tagDefinition ? `hqts1.${await digest(snapshot!)}` : form?.snapshotToken ?? r2!.snapshotToken;
    statements.push({ sql: `INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status,created_by,expires_at) VALUES (?,?,?,?,?,'create',?,?,'ready',?,?)`, bindings: [storeId, authority.tenantId, id, template.current_version_id!, account.id, preflightId, token, authority.actorId, expiresAt] });
    for (const item of items) statements.push({ sql: `INSERT INTO hq_template_preflight_resolutions(preflight_id,tenant_id,template_id,template_version_id,target_account_id,idempotency_fingerprint,snapshot_token,source_id,item_kind,resolution_mode,target_id,expected_revision) VALUES (?,?,?,?,?,?,?,?,?,'create',?,?)`, bindings: [storeId, authority.tenantId, id, template.current_version_id!, account.id, preflightId, token, item.sourceId, item.itemKind, item.targetId, item.expectedRevision] });
    stores.push({ accountId: account.id, accountName: account.name, items });
  }
  for (const account of accounts) statements.unshift(guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL)`, [account.id, authority.tenantId]));
  await batch(db, statements);
  return { preflightId, expiresAt, stores };
}
function resultReason(status: string): string | null {
  if (status === 'version_conflict') return VERSION_CONFLICT_MESSAGE;
  if (status === 'failed') return 'この店舗には配布できませんでした。もう一度確認してください';
  if (status === 'unsupported') return 'この種類の配布はまだ利用できません';
  return null;
}
function rethrowR2(error: unknown): never {
  if (!(error instanceof HqR2RuntimeError)) throw error;
  if (error.code === 'FORBIDDEN') throw new HqTemplateError('FORBIDDEN', 403);
  if (error.code === 'VERSION_CONFLICT' || error.code.includes('UNAVAILABLE') || error.code.startsWith('AMBIGUOUS_')) throw new HqTemplateError('VERSION_CONFLICT', 409);
  if (error.code.includes('UNSUPPORTED')) throw new HqTemplateError('UNSUPPORTED', 422);
  throw new HqTemplateError('INVALID_DEFINITION');
}
export async function distributionResult(db: D1Database, authority: HqTemplateAuthority, templateId: string, runId: string) {
  const run = await db.prepare(`SELECT id,status FROM hq_template_distribution_runs WHERE id=? AND tenant_id=? AND template_id=?`).bind(runId, authority.tenantId, templateId).first<{ id: string; status: string }>();
  if (!run) throw new HqTemplateError('NOT_FOUND', 404);
  const rows = (await db.prepare(`SELECT * FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? ORDER BY target_account_id`).bind(runId, authority.tenantId).all<HqTemplateDistributionResult>()).results;
  const stores = [];
  for (const row of rows) {
    const resolutions = (await db.prepare(`SELECT resolution_mode FROM hq_template_preflight_resolutions WHERE preflight_id=? AND tenant_id=?`).bind(row.preflight_id, authority.tenantId).all<{ resolution_mode: string }>()).results;
    const counts = { created: 0, overwritten: 0, aliased: 0 };
    if (row.status === 'succeeded') for (const r of resolutions) {
      if (r.resolution_mode === 'create') counts.created++; else if (r.resolution_mode === 'overwrite') counts.overwritten++; else counts.aliased++;
    }
    stores.push({ accountId: row.target_account_id, status: row.status, reason: resultReason(row.status), counts });
  }
  const targets = (await db.prepare(`SELECT target_account_id FROM hq_template_preflights WHERE tenant_id=? AND template_id=? AND idempotency_fingerprint=? ORDER BY target_account_id`).bind(authority.tenantId, templateId, runId).all<{ target_account_id: string }>()).results;
  for (const p of targets) if (!stores.some(s => s.accountId === p.target_account_id)) stores.push({ accountId: p.target_account_id, status: 'pending', reason: null, counts: { created: 0, overwritten: 0, aliased: 0 } });
  stores.sort((a,b) => a.accountId.localeCompare(b.accountId));
  return { runId, status: run.status, stores };
}

export async function distributeTemplate(db: D1Database, authority: HqTemplateAuthority, templateId: string, runId: string, selections: DistributionSelection[], bucket?: R2Bucket, publicBaseUrl?: string) {
  const preflights = (await db.prepare(`SELECT * FROM hq_template_preflights WHERE tenant_id=? AND template_id=? AND idempotency_fingerprint=? ORDER BY target_account_id`).bind(authority.tenantId, templateId, runId).all<HqTemplatePreflight>()).results;
  if (!preflights.length || preflights.some(p => p.created_by !== authority.actorId)) throw new HqTemplateError('NOT_FOUND', 404);
  await requireTargetAccounts(db, authority, preflights.map(p => p.target_account_id));
  const { template } = await templateDetail(db, authority, templateId);
  if (preflights.some(p => p.template_version_id !== preflights[0].template_version_id)) throw new HqTemplateError('INVALID_PREFLIGHT', 409);
  const version = await db.prepare(`SELECT definition_json FROM hq_template_versions WHERE id=? AND tenant_id=? AND template_id=?`).bind(preflights[0].template_version_id, authority.tenantId, templateId).first<{ definition_json: string }>();
  if (!version) throw new HqTemplateError('NOT_FOUND', 404);
  const stored = (await db.prepare(`SELECT * FROM hq_template_preflight_resolutions WHERE tenant_id=? AND template_id=? AND idempotency_fingerprint=? ORDER BY target_account_id,source_id`).bind(authority.tenantId, templateId, runId).all<HqTemplatePreflightResolution>()).results;
  if (selections.length !== stored.length || new Set(selections.map(s => JSON.stringify([s.accountId, s.sourceId]))).size !== stored.length) throw new HqTemplateError('SELECTION_REQUIRED', 409);
  for (const selected of selections) {
    const row = stored.find(r => r.target_account_id === selected.accountId && r.source_id === selected.sourceId);
    if (!row || !['create', 'overwrite', 'alias'].includes(selected.mode)) throw new HqTemplateError('SELECTION_REQUIRED', 409);
    const p = preflights.find(p => p.id === row.preflight_id)!;
    if (p.status === 'consumed') { if (template.template_type === 'tag' && row.resolution_mode !== selected.mode) throw new HqTemplateError('SELECTION_CHANGED', 409); }
    else if (row.target_id ? selected.mode === 'create' : selected.mode !== 'create') throw new HqTemplateError('SELECTION_REQUIRED', 409);
  }
  if (template.template_type !== 'tag') {
    if ((template.template_type === 'template' || template.template_type === 'rich_menu') && !bucket) throw new HqTemplateError('UNSUPPORTED', 422);
    for (const p of preflights) {
      const selected = selections.filter(selection => selection.accountId === p.target_account_id).map(selection => {
        const row = stored.find(resolution => resolution.preflight_id === p.id && resolution.source_id === selection.sourceId)!;
        return { sourceId: selection.sourceId, itemKind: row.item_kind, mode: selection.mode };
      });
      const root = selected.find(resolution => resolution.itemKind === template.template_type);
      if (!root) throw new HqTemplateError('SELECTION_REQUIRED', 409);
      try {
        const context = {
          tenantId: authority.tenantId,
          targetAccountId: p.target_account_id,
          preflightId: p.id,
          idempotencyFingerprint: runId,
          snapshotToken: p.snapshot_token as HqTemplateSnapshotToken,
          mode: root.mode,
          resolutions: selected,
        } as const;
        if (template.template_type === 'form') await executeFormStore({ db, authority, templateId, runId, context });
        else await executeR2RuntimeStore({ db, bucket: bucket!, authority, templateId, runId, context, publicBaseUrl });
      } catch (error) {
        if (!(error instanceof HqRuntimeError) && !(error instanceof HqR2RuntimeError)) throw error;
        if (error.code === 'FORBIDDEN') throw new HqTemplateError('FORBIDDEN', 403);
        if (error.code === 'SELECTION_REQUIRED' || error.code === 'SELECTION_CHANGED') throw new HqTemplateError(error.code, 409);
        if (error.code === 'INVALID_PREFLIGHT' || error.code === 'VERSION_CONFLICT') throw new HqTemplateError('VERSION_CONFLICT', 409);
        throw new HqTemplateError('RESULT_UNAVAILABLE', 500);
      }
    }
    const result = await distributionResult(db, authority, templateId, runId);
    if (result.stores.some(store => store.status === 'pending' || store.status === 'staged')) return result;
    const succeeded = result.stores.filter(store => store.status === 'succeeded').length;
    const status = succeeded === preflights.length ? 'completed' : succeeded ? 'partial' : 'failed';
    await db.prepare(`UPDATE hq_template_distribution_runs SET status=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND tenant_id=? AND status='running'`).bind(status, runId, authority.tenantId).run();
    return distributionResult(db, authority, templateId, runId);
  }
  const definition = parseTagDefinition(JSON.parse(version.definition_json));
  await beginHqTemplateDistributionRun(db, { id: runId, tenantId: authority.tenantId, templateId, templateVersionId: preflights[0].template_version_id, idempotencyFingerprint: runId, createdBy: authority.actorId });
  // Claim the complete decision set before any store mutation. This also binds
  // concurrent requests and interrupted runs whose first store has not completed.
  const requestHash = await digest(JSON.stringify([...selections].sort((a,b) => JSON.stringify([a.accountId,a.sourceId]).localeCompare(JSON.stringify([b.accountId,b.sourceId]))).map(s => [s.accountId,s.sourceId,s.mode])));
  const sourceId = JSON.stringify([authority.tenantId, runId]);
  await db.prepare(`INSERT OR IGNORE INTO audit_events(id,source_kind,source_id,tenant_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,'hq_template_distribution_request',?,?,'business',?,?,'hq_template.distribution_started','hq_template',?,'success',?)`).bind(crypto.randomUUID(), sourceId, authority.tenantId, authority.actorId, authority.role, templateId, JSON.stringify({ runId, requestHash })).run();
  const claim = await db.prepare(`SELECT after_json FROM audit_events WHERE source_kind='hq_template_distribution_request' AND source_id=? AND tenant_id=? AND actor_principal_id=?`).bind(sourceId, authority.tenantId, authority.actorId).first<{ after_json: string }>();
  if (!claim || JSON.parse(claim.after_json).requestHash !== requestHash) throw new HqTemplateError('SELECTION_CHANGED', 409);
  for (const p of preflights) {
    const existing = await db.prepare(`SELECT status FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?`).bind(runId, authority.tenantId, p.target_account_id).first();
    if (existing) continue;
    const selected: HqTemplateResolution[] = selections.filter(s => s.accountId === p.target_account_id).map(s => ({ sourceId: s.sourceId, itemKind: stored.find(r => r.preflight_id === p.id && r.source_id === s.sourceId)!.item_kind, mode: s.mode }));
    const snapshot = await tagSnapshot(db, p.target_account_id);
    const conflict = p.expires_at === null || p.expires_at <= new Date().toISOString() || `hqts1.${await digest(snapshot)}` !== p.snapshot_token;
    let status = conflict ? 'version_conflict' : 'succeeded';
    let plan: ReturnType<typeof planTags> | null = null;
    if (!conflict) {
      try {
        const adapter = getHqTemplateAdapter('tag', { db, authority });
        const ok = <T>(result: HqTemplateAdapterResult<T>): T => { if (result.kind !== 'OK') throw new HqTemplateError('UNSUPPORTED', 422); return result.value; };
        const input = { templateVersionId: p.template_version_id, definitionJson: JSON.stringify(definition) };
        const context = { tenantId: authority.tenantId, targetAccountId: p.target_account_id, preflightId: p.id, idempotencyFingerprint: runId, mode: p.distribution_mode, snapshotToken: p.snapshot_token as HqTemplateSnapshotToken, resolutions: selected };
        const refs = ok(await adapter.extractReferences(input));
        const verified = ok(await adapter.verifyReferences(context, refs));
        const duplicates = ok(await adapter.detectDuplicates(context, verified));
        const ids = ok(await adapter.buildIdMap(context, verified, duplicates));
        const commit = ok(await adapter.buildCommitPlan(context, input, ids));
        plan = { statements: [...commit.dbCommit], resolutions: [...commit.resolutions], counts: { created: 0, overwritten: 0, aliased: 0 } };
      }
      catch (error) { status = error instanceof HqTemplateError && error.code === 'VERSION_CONFLICT' ? 'version_conflict' : 'failed'; }
    }
    const persist = (finalStatus: string, commit: HqTemplateStatement[], resolutions: readonly HqTemplateResolution[]) => {
      const statements = [guard(`EXISTS(SELECT 1 FROM hq_template_preflights WHERE id=? AND tenant_id=? AND status='ready') AND NOT EXISTS(SELECT 1 FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?)`, [p.id, authority.tenantId, runId, authority.tenantId, p.target_account_id])];
      if (finalStatus === 'succeeded') statements.push(guard(`EXISTS(SELECT 1 FROM hq_template_preflights WHERE id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, [p.id]));
      // Tenant ownership is also checked inside each atomic store transaction.
      statements.push(guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL)`, [p.target_account_id, authority.tenantId]));
      for (const r of resolutions) statements.push({ sql: `UPDATE hq_template_preflight_resolutions SET resolution_mode=?,target_id=COALESCE(?,target_id),alias_name=?,expected_revision=COALESCE(?,expected_revision) WHERE preflight_id=? AND tenant_id=? AND source_id=?`, bindings: [r.mode, r.targetId ?? null, r.mode === 'alias' ? r.aliasName ?? 'pending' : null, r.expectedRevision ?? null, p.id, authority.tenantId, r.sourceId] });
      statements.push({ sql: `INSERT INTO hq_template_distribution_results(run_id,tenant_id,template_id,template_version_id,target_account_id,preflight_id,idempotency_fingerprint,snapshot_token,status,finished_at) VALUES (?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, bindings: [runId, authority.tenantId, templateId, p.template_version_id, p.target_account_id, p.id, runId, p.snapshot_token, finalStatus] }, ...commit, audit(authority, 'distributed', templateId, p.target_account_id, finalStatus === 'succeeded' ? 'success' : 'failed', runId));
      return batch(db, statements);
    };
    try { await persist(status, plan?.statements ?? [], plan?.resolutions ?? selected); }
    catch {
      const committed = await db.prepare(`SELECT status FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?`).bind(runId, authority.tenantId, p.target_account_id).first();
      if (committed) continue;
      status = !p.expires_at || p.expires_at <= new Date().toISOString() || `hqts1.${await digest(await tagSnapshot(db, p.target_account_id))}` !== p.snapshot_token ? 'version_conflict' : 'failed';
      try { await persist(status, [], plan?.resolutions ?? selected); } catch { throw new HqTemplateError('RESULT_UNAVAILABLE', 500); }
    }
  }
  const result = await distributionResult(db, authority, templateId, runId);
  if (result.stores.some(s => s.status === 'pending' || s.status === 'staged')) return result;
  const succeeded = result.stores.filter(s => s.status === 'succeeded').length;
  const status = succeeded === preflights.length ? 'completed' : succeeded ? 'partial' : 'failed';
  await db.prepare(`UPDATE hq_template_distribution_runs SET status=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND tenant_id=? AND status='running'`).bind(status, runId, authority.tenantId).run();
  return distributionResult(db, authority, templateId, runId);
}
