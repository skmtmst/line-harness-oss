export const HQ_TEMPLATE_TYPES = ['tag', 'template', 'rich_menu', 'form'] as const;
export type HqTemplateType = (typeof HQ_TEMPLATE_TYPES)[number];

export const HQ_TEMPLATE_DISTRIBUTION_MODES = ['create', 'overwrite', 'alias'] as const;
export type HqTemplateDistributionMode = (typeof HQ_TEMPLATE_DISTRIBUTION_MODES)[number];

export type HqTemplateBinding = string | number | null;

export interface HqTemplateStatement {
  sql: string;
  bindings: readonly HqTemplateBinding[];
}

export interface HqTemplateStatementPlan {
  statements: readonly HqTemplateStatement[];
}

export interface HqTemplate {
  id: string;
  tenant_id: string;
  template_type: HqTemplateType;
  name: string;
  description: string | null;
  current_version_id: string | null;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface HqTemplateVersion {
  id: string;
  tenant_id: string;
  template_id: string;
  version: number;
  definition_json: string;
  content_hash: string;
  created_by: string | null;
  created_at: string;
}

export interface HqTemplatePreflight {
  id: string;
  tenant_id: string;
  template_id: string;
  template_version_id: string;
  target_account_id: string;
  distribution_mode: HqTemplateDistributionMode;
  idempotency_fingerprint: string;
  snapshot_token: string;
  status: 'ready' | 'blocked' | 'expired' | 'consumed';
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface HqTemplatePreflightResolution {
  preflight_id: string;
  tenant_id: string;
  template_id: string;
  template_version_id: string;
  target_account_id: string;
  snapshot_token: string;
  source_id: string;
  item_kind: string;
  resolution_mode: HqTemplateDistributionMode;
  target_id: string | null;
  alias_name: string | null;
  expected_revision: string | null;
  created_at: string;
}

export interface HqTemplateDistributionRun {
  id: string;
  tenant_id: string;
  template_id: string;
  template_version_id: string;
  idempotency_fingerprint: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
}

export type HqTemplateStoreResultStatus =
  | 'pending'
  | 'staged'
  | 'succeeded'
  | 'failed'
  | 'version_conflict'
  | 'unsupported';

export interface HqTemplateDistributionResult {
  run_id: string;
  tenant_id: string;
  template_id: string;
  template_version_id: string;
  target_account_id: string;
  preflight_id: string;
  idempotency_fingerprint: string;
  snapshot_token: string;
  status: HqTemplateStoreResultStatus;
  error_code: string | null;
  attempt_count: number;
  started_at: string;
  finished_at: string | null;
}

export type HqTemplateOwnedR2KeyState =
  | 'staged'
  | 'committed'
  | 'cleanup_pending'
  | 'cleaned'
  | 'reconciled';

export interface HqTemplateOwnedR2Key {
  run_id: string;
  tenant_id: string;
  target_account_id: string;
  object_key: string;
  owner_token: string;
  state: HqTemplateOwnedR2KeyState;
  created_at: string;
  updated_at: string;
}

export function prepareHqTemplatePlan(
  db: D1Database,
  plan: HqTemplateStatementPlan,
): D1PreparedStatement[] {
  return plan.statements.map((statement) =>
    db.prepare(statement.sql).bind(...statement.bindings)
  );
}

export async function executeHqTemplatePlan(
  db: D1Database,
  plan: HqTemplateStatementPlan,
) {
  return db.batch(prepareHqTemplatePlan(db, plan));
}

export async function createHqTemplate(
  db: D1Database,
  input: {
    id: string;
    tenantId: string;
    type: HqTemplateType;
    name: string;
    description?: string | null;
    createdBy?: string | null;
  },
): Promise<HqTemplate> {
  await db.prepare(
    `INSERT INTO hq_templates
       (id, tenant_id, template_type, name, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id,
    input.tenantId,
    input.type,
    input.name,
    input.description ?? null,
    input.createdBy ?? null,
  ).run();
  return (await getHqTemplate(db, input.tenantId, input.id))!;
}

export async function getHqTemplate(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<HqTemplate | null> {
  return db.prepare(
    `SELECT * FROM hq_templates WHERE tenant_id = ? AND id = ?`,
  ).bind(tenantId, id).first<HqTemplate>();
}

export async function listHqTemplates(
  db: D1Database,
  tenantId: string,
  type?: HqTemplateType,
): Promise<HqTemplate[]> {
  const query = type
    ? db.prepare(
      `SELECT * FROM hq_templates
       WHERE tenant_id = ? AND template_type = ? AND archived_at IS NULL
       ORDER BY updated_at DESC, id`,
    ).bind(tenantId, type)
    : db.prepare(
      `SELECT * FROM hq_templates
       WHERE tenant_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, id`,
    ).bind(tenantId);
  const result = await query.all<HqTemplate>();
  return result.results ?? [];
}

export async function updateHqTemplate(
  db: D1Database,
  input: {
    tenantId: string;
    id: string;
    expectedRevision: number;
    name: string;
    description?: string | null;
  },
): Promise<{ kind: 'updated'; template: HqTemplate } | { kind: 'conflict_or_missing' }> {
  const result = await db.prepare(
    `UPDATE hq_templates
     SET name = ?, description = ?, revision = revision + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE tenant_id = ? AND id = ? AND revision = ? AND archived_at IS NULL`,
  ).bind(
    input.name,
    input.description ?? null,
    input.tenantId,
    input.id,
    input.expectedRevision,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) return { kind: 'conflict_or_missing' };
  return {
    kind: 'updated',
    template: (await getHqTemplate(db, input.tenantId, input.id))!,
  };
}

export async function archiveHqTemplate(
  db: D1Database,
  input: { tenantId: string; id: string; expectedRevision: number },
): Promise<{ kind: 'archived'; template: HqTemplate } | { kind: 'conflict_or_missing' }> {
  const result = await db.prepare(
    `UPDATE hq_templates
     SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revision = revision + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE tenant_id = ? AND id = ? AND revision = ? AND archived_at IS NULL`,
  ).bind(input.tenantId, input.id, input.expectedRevision).run();
  if ((result.meta.changes ?? 0) !== 1) return { kind: 'conflict_or_missing' };
  return { kind: 'archived', template: (await getHqTemplate(db, input.tenantId, input.id))! };
}

export function buildCreateHqTemplateVersionPlan(input: {
  id: string;
  tenantId: string;
  templateId: string;
  version: number;
  definitionJson: string;
  contentHash: string;
  createdBy?: string | null;
  expectedTemplateRevision: number;
}): HqTemplateStatementPlan {
  return {
    statements: [
      {
        sql: `INSERT INTO hq_template_versions
                (id, tenant_id, template_id, version, definition_json, content_hash, created_by)
              SELECT ?, ?, ?, ?, ?, ?, ?
              FROM hq_templates
              WHERE id = ? AND tenant_id = ? AND revision = ? AND archived_at IS NULL`,
        bindings: [
          input.id,
          input.tenantId,
          input.templateId,
          input.version,
          input.definitionJson,
          input.contentHash,
          input.createdBy ?? null,
          input.templateId,
          input.tenantId,
          input.expectedTemplateRevision,
        ],
      },
      {
        sql: `UPDATE hq_templates
              SET current_version_id = ?, revision = revision + 1,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE id = ? AND tenant_id = ? AND revision = ? AND archived_at IS NULL`,
        bindings: [
          input.id,
          input.templateId,
          input.tenantId,
          input.expectedTemplateRevision,
        ],
      },
    ],
  };
}

export async function createHqTemplateVersion(
  db: D1Database,
  input: Parameters<typeof buildCreateHqTemplateVersionPlan>[0],
): Promise<{ kind: 'created'; version: HqTemplateVersion } | { kind: 'conflict_or_missing' }> {
  const results = await executeHqTemplatePlan(db, buildCreateHqTemplateVersionPlan(input));
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    return { kind: 'conflict_or_missing' };
  }
  const version = await db.prepare(
    `SELECT * FROM hq_template_versions
     WHERE id = ? AND tenant_id = ? AND template_id = ?`,
  ).bind(input.id, input.tenantId, input.templateId).first<HqTemplateVersion>();
  return version ? { kind: 'created', version } : { kind: 'conflict_or_missing' };
}

export async function listHqTemplateVersions(
  db: D1Database,
  tenantId: string,
  templateId: string,
): Promise<HqTemplateVersion[]> {
  const result = await db.prepare(
    `SELECT * FROM hq_template_versions
     WHERE tenant_id = ? AND template_id = ? ORDER BY version DESC`,
  ).bind(tenantId, templateId).all<HqTemplateVersion>();
  return result.results ?? [];
}

export async function saveHqTemplatePreflight(
  db: D1Database,
  input: {
    id: string;
    tenantId: string;
    templateId: string;
    templateVersionId: string;
    targetAccountId: string;
    distributionMode: HqTemplateDistributionMode;
    idempotencyFingerprint: string;
    snapshotToken: string;
    expectedSnapshotToken?: string;
    status: 'ready' | 'blocked';
    createdBy?: string | null;
    expiresAt?: string | null;
  },
): Promise<
  | { kind: 'saved'; preflight: HqTemplatePreflight }
  | { kind: 'conflict_or_missing' }
> {
  const result = await db.prepare(
    `INSERT INTO hq_template_preflights
       (id, tenant_id, template_id, template_version_id, target_account_id,
        distribution_mode, idempotency_fingerprint, snapshot_token, status, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET
       snapshot_token = excluded.snapshot_token,
       status = excluded.status,
       expires_at = excluded.expires_at
     WHERE hq_template_preflights.id = excluded.id
       AND hq_template_preflights.tenant_id = excluded.tenant_id
       AND hq_template_preflights.template_id = excluded.template_id
       AND hq_template_preflights.template_version_id = excluded.template_version_id
       AND hq_template_preflights.target_account_id = excluded.target_account_id
       AND hq_template_preflights.distribution_mode = excluded.distribution_mode
       AND hq_template_preflights.idempotency_fingerprint = excluded.idempotency_fingerprint
       AND hq_template_preflights.snapshot_token = ?
       AND hq_template_preflights.status IN ('ready', 'blocked')`,
  ).bind(
    input.id,
    input.tenantId,
    input.templateId,
    input.templateVersionId,
    input.targetAccountId,
    input.distributionMode,
    input.idempotencyFingerprint,
    input.snapshotToken,
    input.status,
    input.createdBy ?? null,
    input.expiresAt ?? null,
    input.expectedSnapshotToken ?? input.snapshotToken,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) return { kind: 'conflict_or_missing' };
  const preflight = await db.prepare(
    `SELECT * FROM hq_template_preflights WHERE id = ? AND tenant_id = ?`,
  ).bind(input.id, input.tenantId).first<HqTemplatePreflight>();
  return preflight ? { kind: 'saved', preflight } : { kind: 'conflict_or_missing' };
}

export async function saveHqTemplatePreflightResolution(
  db: D1Database,
  input: {
    preflightId: string;
    tenantId: string;
    templateId: string;
    templateVersionId: string;
    targetAccountId: string;
    snapshotToken: string;
    sourceId: string;
    itemKind: string;
    resolutionMode: HqTemplateDistributionMode;
    targetId?: string | null;
    aliasName?: string | null;
    expectedRevision?: string | null;
  },
): Promise<
  | { kind: 'saved'; resolution: HqTemplatePreflightResolution }
  | { kind: 'conflict_or_missing' }
> {
  const result = await db.prepare(
    `INSERT INTO hq_template_preflight_resolutions
       (preflight_id, tenant_id, template_id, template_version_id, target_account_id,
        snapshot_token, source_id, item_kind, resolution_mode, target_id, alias_name, expected_revision)
     SELECT id, tenant_id, template_id, template_version_id, target_account_id,
            snapshot_token, ?, ?, ?, ?, ?, ?
     FROM hq_template_preflights
     WHERE id = ? AND tenant_id = ? AND template_id = ? AND template_version_id = ?
       AND target_account_id = ? AND snapshot_token = ? AND status IN ('ready', 'blocked')
     ON CONFLICT(preflight_id, tenant_id, source_id) DO UPDATE SET
       item_kind = excluded.item_kind,
       resolution_mode = excluded.resolution_mode,
       target_id = excluded.target_id,
       alias_name = excluded.alias_name,
       expected_revision = excluded.expected_revision
     WHERE hq_template_preflight_resolutions.template_id = excluded.template_id
       AND hq_template_preflight_resolutions.template_version_id = excluded.template_version_id
       AND hq_template_preflight_resolutions.target_account_id = excluded.target_account_id
       AND hq_template_preflight_resolutions.snapshot_token = excluded.snapshot_token`,
  ).bind(
    input.sourceId,
    input.itemKind,
    input.resolutionMode,
    input.targetId ?? null,
    input.aliasName ?? null,
    input.expectedRevision ?? null,
    input.preflightId,
    input.tenantId,
    input.templateId,
    input.templateVersionId,
    input.targetAccountId,
    input.snapshotToken,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) return { kind: 'conflict_or_missing' };
  const resolution = await db.prepare(
    `SELECT * FROM hq_template_preflight_resolutions
     WHERE preflight_id = ? AND tenant_id = ? AND source_id = ?`,
  ).bind(input.preflightId, input.tenantId, input.sourceId)
    .first<HqTemplatePreflightResolution>();
  return resolution ? { kind: 'saved', resolution } : { kind: 'conflict_or_missing' };
}

export async function listHqTemplatePreflightResolutions(
  db: D1Database,
  tenantId: string,
  preflightId: string,
): Promise<HqTemplatePreflightResolution[]> {
  const result = await db.prepare(
    `SELECT * FROM hq_template_preflight_resolutions
     WHERE tenant_id = ? AND preflight_id = ? ORDER BY source_id`,
  ).bind(tenantId, preflightId).all<HqTemplatePreflightResolution>();
  return result.results ?? [];
}

export async function beginHqTemplateDistributionRun(
  db: D1Database,
  input: {
    id: string;
    tenantId: string;
    templateId: string;
    templateVersionId: string;
    idempotencyFingerprint: string;
    createdBy?: string | null;
  },
): Promise<{ run: HqTemplateDistributionRun; reused: boolean }> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO hq_template_distribution_runs
       (id, tenant_id, template_id, template_version_id, idempotency_fingerprint, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`,
  ).bind(
    input.id,
    input.tenantId,
    input.templateId,
    input.templateVersionId,
    input.idempotencyFingerprint,
    input.createdBy ?? null,
  ).run();
  const run = await db.prepare(
    `SELECT * FROM hq_template_distribution_runs
     WHERE tenant_id = ? AND idempotency_fingerprint = ?`,
  ).bind(input.tenantId, input.idempotencyFingerprint).first<HqTemplateDistributionRun>();
  if (
    !run
    || run.id !== input.id
    || run.template_id !== input.templateId
    || run.template_version_id !== input.templateVersionId
  ) {
    throw new Error('HQ_TEMPLATE_RUN_BINDING_CONFLICT');
  }
  return { run, reused: (inserted.meta.changes ?? 0) === 0 };
}

export async function beginHqTemplateStoreResult(
  db: D1Database,
  input: {
    runId: string;
    tenantId: string;
    templateId: string;
    templateVersionId: string;
    targetAccountId: string;
    preflightId: string;
    idempotencyFingerprint: string;
    snapshotToken: string;
  },
): Promise<
  | { kind: 'created' | 'reused'; result: HqTemplateDistributionResult }
  | { kind: 'conflict_or_missing' }
> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO hq_template_distribution_results
       (run_id, tenant_id, template_id, template_version_id, target_account_id, preflight_id,
        idempotency_fingerprint, snapshot_token, status)
     SELECT r.id, r.tenant_id, r.template_id, r.template_version_id, p.target_account_id, p.id,
            ?, p.snapshot_token, 'pending'
     FROM hq_template_distribution_runs r
     JOIN hq_template_preflights p
       ON p.id = ? AND p.tenant_id = r.tenant_id
      AND p.template_id = r.template_id AND p.template_version_id = r.template_version_id
     WHERE r.id = ? AND r.tenant_id = ? AND r.template_id = ? AND r.template_version_id = ?
       AND r.status = 'running' AND p.target_account_id = ?
       AND p.idempotency_fingerprint = ? AND p.snapshot_token = ? AND p.status = 'ready'`,
  ).bind(
    input.idempotencyFingerprint,
    input.preflightId,
    input.runId,
    input.tenantId,
    input.templateId,
    input.templateVersionId,
    input.targetAccountId,
    input.idempotencyFingerprint,
    input.snapshotToken,
  ).run();

  const result = await db.prepare(
    `SELECT * FROM hq_template_distribution_results
     WHERE run_id = ? AND tenant_id = ? AND target_account_id = ?`,
  ).bind(input.runId, input.tenantId, input.targetAccountId)
    .first<HqTemplateDistributionResult>();
  if (
    !result
    || result.template_id !== input.templateId
    || result.template_version_id !== input.templateVersionId
    || result.preflight_id !== input.preflightId
    || result.idempotency_fingerprint !== input.idempotencyFingerprint
    || result.snapshot_token !== input.snapshotToken
  ) {
    return { kind: 'conflict_or_missing' };
  }

  const consumed = await db.prepare(
    `UPDATE hq_template_preflights SET status = 'consumed'
     WHERE id = ? AND tenant_id = ? AND template_id = ? AND template_version_id = ?
       AND target_account_id = ? AND idempotency_fingerprint = ? AND snapshot_token = ?
       AND status = 'ready'
       AND EXISTS (
         SELECT 1 FROM hq_template_distribution_results d
         WHERE d.run_id = ? AND d.tenant_id = hq_template_preflights.tenant_id
           AND d.target_account_id = hq_template_preflights.target_account_id
           AND d.preflight_id = hq_template_preflights.id
       )`,
  ).bind(
    input.preflightId,
    input.tenantId,
    input.templateId,
    input.templateVersionId,
    input.targetAccountId,
    input.idempotencyFingerprint,
    input.snapshotToken,
    input.runId,
  ).run();
  if ((inserted.meta.changes ?? 0) === 1 && (consumed.meta.changes ?? 0) !== 1) {
    throw new Error('HQ_TEMPLATE_PREFLIGHT_NOT_CONSUMED');
  }
  return { kind: (inserted.meta.changes ?? 0) === 1 ? 'created' : 'reused', result };
}

export async function transitionHqTemplateStoreResult(
  db: D1Database,
  input: {
    runId: string;
    tenantId: string;
    templateId: string;
    templateVersionId: string;
    targetAccountId: string;
    preflightId: string;
    idempotencyFingerprint: string;
    snapshotToken: string;
    expectedStatus: HqTemplateStoreResultStatus;
    status: HqTemplateStoreResultStatus;
    errorCode?: string | null;
    finishedAt?: string | null;
  },
): Promise<
  | { kind: 'transitioned'; result: HqTemplateDistributionResult }
  | { kind: 'conflict_or_missing' }
> {
  const transition = await db.prepare(
    `UPDATE hq_template_distribution_results
     SET status = ?, error_code = ?,
         attempt_count = attempt_count + CASE WHEN ? = 'staged' THEN 1 ELSE 0 END,
         finished_at = ?
     WHERE run_id = ? AND tenant_id = ? AND template_id = ? AND template_version_id = ?
       AND target_account_id = ? AND preflight_id = ?
       AND idempotency_fingerprint = ? AND snapshot_token = ? AND status = ?
       AND (status NOT IN ('succeeded', 'version_conflict', 'unsupported') OR status = ?)`,
  ).bind(
    input.status,
    input.errorCode ?? null,
    input.status,
    input.finishedAt ?? null,
    input.runId,
    input.tenantId,
    input.templateId,
    input.templateVersionId,
    input.targetAccountId,
    input.preflightId,
    input.idempotencyFingerprint,
    input.snapshotToken,
    input.expectedStatus,
    input.status,
  ).run();
  if ((transition.meta.changes ?? 0) !== 1) return { kind: 'conflict_or_missing' };
  const result = await db.prepare(
    `SELECT * FROM hq_template_distribution_results
     WHERE run_id = ? AND tenant_id = ? AND target_account_id = ?`,
  ).bind(input.runId, input.tenantId, input.targetAccountId)
    .first<HqTemplateDistributionResult>();
  return result ? { kind: 'transitioned', result } : { kind: 'conflict_or_missing' };
}

export async function finishHqTemplateDistributionRun(
  db: D1Database,
  tenantId: string,
  runId: string,
  status: Exclude<HqTemplateDistributionRun['status'], 'running'>,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE hq_template_distribution_runs
     SET status = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND tenant_id = ? AND status = 'running'`,
  ).bind(status, runId, tenantId).run();
  return (result.meta.changes ?? 0) === 1;
}

export function shouldRetryHqTemplateStoreResult(
  result: HqTemplateDistributionResult | null,
): boolean {
  return result === null || result.status === 'pending' || result.status === 'staged' || result.status === 'failed';
}

export async function recordHqTemplateOwnedR2Key(
  db: D1Database,
  input: {
    runId: string;
    tenantId: string;
    targetAccountId: string;
    objectKey: string;
    ownerToken: string;
  },
): Promise<'recorded' | 'reused' | 'conflict_or_missing'> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO hq_template_owned_r2_keys
       (run_id, tenant_id, target_account_id, object_key, owner_token, state)
     VALUES (?, ?, ?, ?, ?, 'staged')`,
  ).bind(
    input.runId,
    input.tenantId,
    input.targetAccountId,
    input.objectKey,
    input.ownerToken,
  ).run();
  const row = await db.prepare(
    `SELECT owner_token FROM hq_template_owned_r2_keys
     WHERE run_id = ? AND tenant_id = ? AND target_account_id = ? AND object_key = ?`,
  ).bind(input.runId, input.tenantId, input.targetAccountId, input.objectKey)
    .first<{ owner_token: string }>();
  if (!row || row.owner_token !== input.ownerToken) return 'conflict_or_missing';
  return (inserted.meta.changes ?? 0) === 1 ? 'recorded' : 'reused';
}

export async function setHqTemplateOwnedR2KeyState(
  db: D1Database,
  input: {
    runId: string;
    tenantId: string;
    targetAccountId: string;
    objectKey: string;
    ownerToken: string;
    expectedState: HqTemplateOwnedR2KeyState;
    state: HqTemplateOwnedR2KeyState;
  },
): Promise<boolean> {
  const allowed: Readonly<Record<HqTemplateOwnedR2KeyState, readonly HqTemplateOwnedR2KeyState[]>> = {
    staged: ['staged', 'committed', 'cleanup_pending'],
    committed: ['committed', 'reconciled'],
    cleanup_pending: ['cleanup_pending', 'cleaned', 'reconciled'],
    cleaned: ['cleaned'],
    reconciled: ['reconciled'],
  };
  if (!allowed[input.expectedState].includes(input.state)) return false;
  const result = await db.prepare(
    `UPDATE hq_template_owned_r2_keys
     SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE run_id = ? AND tenant_id = ? AND target_account_id = ?
       AND object_key = ? AND owner_token = ? AND state = ?`,
  ).bind(
    input.state,
    input.runId,
    input.tenantId,
    input.targetAccountId,
    input.objectKey,
    input.ownerToken,
    input.expectedState,
  ).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function listHqTemplateR2KeysForReconcile(
  db: D1Database,
  tenantId: string,
  limit = 100,
): Promise<HqTemplateOwnedR2Key[]> {
  const result = await db.prepare(
    `SELECT * FROM hq_template_owned_r2_keys
     WHERE tenant_id = ? AND state IN ('staged', 'cleanup_pending')
     ORDER BY updated_at, run_id, target_account_id, object_key
     LIMIT ?`,
  ).bind(tenantId, Math.max(1, Math.min(limit, 500))).all<HqTemplateOwnedR2Key>();
  return result.results ?? [];
}
