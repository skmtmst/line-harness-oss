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
  snapshot_token: string;
  status: 'ready' | 'blocked' | 'expired';
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface HqTemplateDistributionRun {
  id: string;
  tenant_id: string;
  template_id: string;
  template_version_id: string;
  preflight_id: string | null;
  distribution_mode: HqTemplateDistributionMode;
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
  target_account_id: string;
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
       WHERE tenant_id = ? AND template_type = ?
       ORDER BY updated_at DESC, id`,
    ).bind(tenantId, type)
    : db.prepare(
      `SELECT * FROM hq_templates
       WHERE tenant_id = ? ORDER BY updated_at DESC, id`,
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
     WHERE tenant_id = ? AND id = ? AND revision = ?`,
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

export async function deleteHqTemplate(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const result = await db.prepare(
    `DELETE FROM hq_templates WHERE tenant_id = ? AND id = ?`,
  ).bind(tenantId, id).run();
  return (result.meta.changes ?? 0) === 1;
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
              WHERE id = ? AND tenant_id = ? AND revision = ?`,
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
              WHERE id = ? AND tenant_id = ? AND revision = ?`,
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
  if ((results[1]?.meta.changes ?? 0) !== 1) return { kind: 'conflict_or_missing' };
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
    snapshotToken: string;
    status: HqTemplatePreflight['status'];
    createdBy?: string | null;
    expiresAt?: string | null;
  },
): Promise<HqTemplatePreflight> {
  await db.prepare(
    `INSERT INTO hq_template_preflights
       (id, tenant_id, template_id, template_version_id, target_account_id,
        distribution_mode, snapshot_token, status, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       snapshot_token = excluded.snapshot_token,
       status = excluded.status,
       expires_at = excluded.expires_at`,
  ).bind(
    input.id,
    input.tenantId,
    input.templateId,
    input.templateVersionId,
    input.targetAccountId,
    input.distributionMode,
    input.snapshotToken,
    input.status,
    input.createdBy ?? null,
    input.expiresAt ?? null,
  ).run();
  return (await db.prepare(
    `SELECT * FROM hq_template_preflights WHERE id = ? AND tenant_id = ?`,
  ).bind(input.id, input.tenantId).first<HqTemplatePreflight>())!;
}

export async function beginHqTemplateDistributionRun(
  db: D1Database,
  input: {
    id: string;
    tenantId: string;
    templateId: string;
    templateVersionId: string;
    preflightId?: string | null;
    distributionMode: HqTemplateDistributionMode;
    idempotencyFingerprint: string;
    createdBy?: string | null;
  },
): Promise<{ run: HqTemplateDistributionRun; reused: boolean }> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO hq_template_distribution_runs
       (id, tenant_id, template_id, template_version_id, preflight_id,
        distribution_mode, idempotency_fingerprint, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
  ).bind(
    input.id,
    input.tenantId,
    input.templateId,
    input.templateVersionId,
    input.preflightId ?? null,
    input.distributionMode,
    input.idempotencyFingerprint,
    input.createdBy ?? null,
  ).run();
  const run = await db.prepare(
    `SELECT * FROM hq_template_distribution_runs
     WHERE tenant_id = ? AND idempotency_fingerprint = ?`,
  ).bind(input.tenantId, input.idempotencyFingerprint).first<HqTemplateDistributionRun>();
  if (!run) throw new Error('HQ_TEMPLATE_RUN_NOT_CREATED');
  return { run, reused: (inserted.meta.changes ?? 0) === 0 };
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

export async function saveHqTemplateStoreResult(
  db: D1Database,
  input: {
    runId: string;
    tenantId: string;
    targetAccountId: string;
    idempotencyFingerprint: string;
    snapshotToken: string;
    status: HqTemplateStoreResultStatus;
    errorCode?: string | null;
    finishedAt?: string | null;
  },
): Promise<HqTemplateDistributionResult> {
  await db.prepare(
    `INSERT INTO hq_template_distribution_results
       (run_id, tenant_id, target_account_id, idempotency_fingerprint,
        snapshot_token, status, error_code, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, target_account_id) DO UPDATE SET
       snapshot_token = excluded.snapshot_token,
       status = excluded.status,
       error_code = excluded.error_code,
       attempt_count = hq_template_distribution_results.attempt_count + 1,
       finished_at = excluded.finished_at`,
  ).bind(
    input.runId,
    input.tenantId,
    input.targetAccountId,
    input.idempotencyFingerprint,
    input.snapshotToken,
    input.status,
    input.errorCode ?? null,
    input.finishedAt ?? null,
  ).run();
  return (await db.prepare(
    `SELECT * FROM hq_template_distribution_results
     WHERE run_id = ? AND tenant_id = ? AND target_account_id = ?`,
  ).bind(input.runId, input.tenantId, input.targetAccountId)
    .first<HqTemplateDistributionResult>())!;
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
): Promise<void> {
  await db.prepare(
    `INSERT INTO hq_template_owned_r2_keys
       (run_id, tenant_id, target_account_id, object_key, owner_token, state)
     VALUES (?, ?, ?, ?, ?, 'staged')
     ON CONFLICT(run_id, target_account_id, object_key) DO NOTHING`,
  ).bind(
    input.runId,
    input.tenantId,
    input.targetAccountId,
    input.objectKey,
    input.ownerToken,
  ).run();
}

export async function setHqTemplateOwnedR2KeyState(
  db: D1Database,
  input: {
    runId: string;
    tenantId: string;
    targetAccountId: string;
    objectKey: string;
    ownerToken: string;
    state: HqTemplateOwnedR2KeyState;
  },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE hq_template_owned_r2_keys
     SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE run_id = ? AND tenant_id = ? AND target_account_id = ?
       AND object_key = ? AND owner_token = ?`,
  ).bind(
    input.state,
    input.runId,
    input.tenantId,
    input.targetAccountId,
    input.objectKey,
    input.ownerToken,
  ).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function listHqTemplateR2KeysForReconcile(
  db: D1Database,
  limit = 100,
): Promise<HqTemplateOwnedR2Key[]> {
  const result = await db.prepare(
    `SELECT * FROM hq_template_owned_r2_keys
     WHERE state IN ('staged', 'cleanup_pending')
     ORDER BY updated_at, run_id, target_account_id, object_key
     LIMIT ?`,
  ).bind(Math.max(1, Math.min(limit, 500))).all<HqTemplateOwnedR2Key>();
  return result.results ?? [];
}
