export const HQ_TEMPLATE_TYPES = ['tag', 'template', 'rich_menu', 'form', 'scenario', 'friend_field', 'mark'] as const;
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
  folder_id?: string | null;
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
  text_override?: string | null;
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
  idempotency_fingerprint: string;
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
  created_name?: string | null;
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
       (id, tenant_id, template_type, extended_type, friend_attribute_type, name, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id,
    input.tenantId,
    input.type==='scenario'?'template':input.type==='friend_field'||input.type==='mark'?'tag':input.type,
    input.type==='scenario'?'scenario':null,
    input.type==='friend_field'||input.type==='mark'?input.type:null,
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
    `SELECT *,COALESCE(friend_attribute_type,extended_type,template_type) AS template_type FROM hq_templates WHERE tenant_id = ? AND id = ?`,
  ).bind(tenantId, id).first<HqTemplate>();
}

export async function listHqTemplates(
  db: D1Database,
  tenantId: string,
  type?: HqTemplateType,
): Promise<HqTemplate[]> {
  const query = type
    ? db.prepare(
      `SELECT *,COALESCE(friend_attribute_type,extended_type,template_type) AS template_type FROM hq_templates
       WHERE tenant_id = ? AND COALESCE(friend_attribute_type,extended_type,template_type) = ? AND archived_at IS NULL
       ORDER BY updated_at DESC, id`,
    ).bind(tenantId, type)
    : db.prepare(
      `SELECT *,COALESCE(friend_attribute_type,extended_type,template_type) AS template_type FROM hq_templates
       WHERE tenant_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, id`,
    ).bind(tenantId);
  const result = await query.all<HqTemplate>();
  return result.results ?? [];
}

/** 一覧の材料を一度の問い合わせで取得する。definition_jsonはHTTP応答へ出さない。 */
export interface HqTemplateListSource extends HqTemplate {
  display_type: HqTemplateType;
  definition_json: string | null;
  distributed_account_names_json: string;
  distributed_account_count: number;
  this_month_sent_count: number | null;
  outdated_account_count: number;
  current_version: number | null;
  friend_count: number | null;
  tap_count: number | null;
}

export async function listHqTemplateDisplaySources(
  db: D1Database,
  tenantId: string,
  type?: HqTemplateType,
): Promise<HqTemplateListSource[]> {
  const result = await db.prepare(`
    WITH templates AS (
      SELECT *, COALESCE(friend_attribute_type,extended_type,template_type) AS display_type
      FROM hq_templates WHERE tenant_id=?1 AND archived_at IS NULL
        AND (?2 IS NULL OR COALESCE(friend_attribute_type,extended_type,template_type)=?2)
    ), successful_accounts AS (
      SELECT DISTINCT r.template_id, a.id AS account_id, a.name
      FROM hq_template_distribution_results r
      JOIN templates t ON t.id=r.template_id AND t.tenant_id=r.tenant_id
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      WHERE r.tenant_id=?1 AND r.status='succeeded' AND NOT EXISTS (SELECT 1 FROM hq_template_preflight_resolutions skipped WHERE skipped.preflight_id=r.preflight_id AND skipped.tenant_id=r.tenant_id AND skipped.friend_attribute_mode='skip')
    ), received AS (
      SELECT r.template_id,r.target_account_id,r.template_version_id,
        ROW_NUMBER() OVER (PARTITION BY r.template_id,r.target_account_id ORDER BY r.finished_at DESC,r.started_at DESC,r.rowid DESC) AS position
      FROM hq_template_distribution_results r
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      WHERE r.tenant_id=?1 AND r.status='succeeded' AND NOT EXISTS (SELECT 1 FROM hq_template_preflight_resolutions skipped WHERE skipped.preflight_id=r.preflight_id AND skipped.tenant_id=r.tenant_id AND skipped.friend_attribute_mode='skip')
    ), outdated AS (
      SELECT r.template_id,COUNT(*) AS count FROM received r JOIN templates t ON t.id=r.template_id
      WHERE r.position=1 AND r.template_version_id<>t.current_version_id GROUP BY r.template_id
    ), sent AS (
      SELECT r.template_id,COUNT(DISTINCT m.id) AS count
      FROM hq_template_distribution_results r
      JOIN templates t ON t.id=r.template_id AND t.tenant_id=r.tenant_id AND t.display_type='template'
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      JOIN hq_template_versions v ON v.id=r.template_version_id AND v.tenant_id=r.tenant_id AND v.template_id=r.template_id
      JOIN hq_template_preflight_resolutions p ON p.preflight_id=r.preflight_id AND p.tenant_id=r.tenant_id
        AND p.target_account_id=r.target_account_id AND p.item_kind='template'
        AND p.source_id='template:' || json_extract(v.definition_json,'$.template.id')
      JOIN messages_log m ON m.template_id_at_send=p.target_id AND m.line_account_id=r.target_account_id
      WHERE r.tenant_id=?1 AND r.status='succeeded' AND NOT EXISTS (SELECT 1 FROM hq_template_preflight_resolutions skipped WHERE skipped.preflight_id=r.preflight_id AND skipped.tenant_id=r.tenant_id AND skipped.friend_attribute_mode='skip') AND m.direction='outgoing'
        AND COALESCE(m.delivery_type,'')<>'test' AND substr(m.created_at,1,7)=strftime('%Y-%m','now','+9 hours')
      GROUP BY r.template_id
    ), tag_population AS (
      SELECT r.template_id,COUNT(DISTINCT f.id) AS count FROM hq_template_distribution_results r
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      JOIN hq_template_preflight_resolutions p ON p.preflight_id=r.preflight_id AND p.tenant_id=r.tenant_id
        AND p.target_account_id=r.target_account_id AND p.item_kind='tag' AND p.source_id='tag'
      JOIN friend_tags ft ON ft.tag_id=p.target_id JOIN friends f ON f.id=ft.friend_id AND f.line_account_id=r.target_account_id
      WHERE r.tenant_id=?1 AND r.status='succeeded' AND NOT EXISTS (SELECT 1 FROM hq_template_preflight_resolutions skipped WHERE skipped.preflight_id=r.preflight_id AND skipped.tenant_id=r.tenant_id AND skipped.friend_attribute_mode='skip') GROUP BY r.template_id
    ), field_population AS (
      SELECT r.template_id,COUNT(DISTINCT f.id) AS count FROM hq_template_distribution_results r
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      JOIN hq_template_preflight_resolutions p ON p.preflight_id=r.preflight_id AND p.tenant_id=r.tenant_id
        AND p.target_account_id=r.target_account_id AND p.item_kind='friend_field' AND p.friend_attribute_mode IS NULL
      JOIN friend_field_scopes scope ON scope.field_id=p.target_id AND scope.tenant_id=r.tenant_id AND scope.line_account_id=r.target_account_id
      JOIN friend_field_values value ON value.field_id=p.target_id AND (
        (value.value IS NOT NULL AND value.value<>'') OR value.media_id IS NOT NULL OR value.value_number IS NOT NULL
        OR value.value_date IS NOT NULL OR value.value_datetime IS NOT NULL OR (value.value_text IS NOT NULL AND value.value_text<>''))
      JOIN friends f ON f.id=value.friend_id AND f.line_account_id=r.target_account_id
      WHERE r.tenant_id=?1 AND r.status='succeeded' GROUP BY r.template_id
    ), mark_population AS (
      SELECT r.template_id,COUNT(DISTINCT f.id) AS count FROM hq_template_distribution_results r
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      JOIN hq_template_preflight_resolutions p ON p.preflight_id=r.preflight_id AND p.tenant_id=r.tenant_id
        AND p.target_account_id=r.target_account_id AND p.item_kind='mark' AND p.friend_attribute_mode IS NULL
      JOIN support_mark_scopes scope ON scope.mark_id=p.target_id AND scope.tenant_id=r.tenant_id AND scope.line_account_id=r.target_account_id
      JOIN friends f ON f.support_mark_id=p.target_id AND f.line_account_id=r.target_account_id
      WHERE r.tenant_id=?1 AND r.status='succeeded' GROUP BY r.template_id
    ), menu_taps AS (
      SELECT r.template_id,COUNT(DISTINCT tap.id) AS count FROM hq_template_distribution_results r
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      JOIN hq_template_preflight_resolutions p ON p.preflight_id=r.preflight_id AND p.tenant_id=r.tenant_id
        AND p.target_account_id=r.target_account_id AND p.item_kind='rich_menu'
      JOIN rich_menu_area_taps tap ON tap.group_id=p.target_id AND tap.line_account_id=r.target_account_id
      WHERE r.tenant_id=?1 AND r.status='succeeded' AND NOT EXISTS (SELECT 1 FROM hq_template_preflight_resolutions skipped WHERE skipped.preflight_id=r.preflight_id AND skipped.tenant_id=r.tenant_id AND skipped.friend_attribute_mode='skip') GROUP BY r.template_id
    ), ranked_accounts AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY template_id ORDER BY name,account_id) AS position
      FROM successful_accounts
    ), distribution AS (
      SELECT template_id, COUNT(*) AS account_count,
        json_group_array(name) FILTER (WHERE position<=3) AS names_json
      FROM (SELECT * FROM ranked_accounts ORDER BY template_id,position)
      GROUP BY template_id
    )
    SELECT t.*, t.display_type AS template_type, v.definition_json,
      COALESCE(d.account_count,0) AS distributed_account_count,
      COALESCE(d.names_json,'[]') AS distributed_account_names_json,
      CASE WHEN json_type(CASE WHEN json_valid(v.definition_json) THEN v.definition_json ELSE '{}' END,'$.asset')='object' THEN NULL ELSE COALESCE(s.count,0) END AS this_month_sent_count, COALESCE(o.count,0) AS outdated_account_count, v.version AS current_version,
      CASE t.display_type WHEN 'tag' THEN COALESCE(tp.count,0) WHEN 'friend_field' THEN COALESCE(fp.count,0) WHEN 'mark' THEN COALESCE(mp.count,0) ELSE NULL END AS friend_count,
      CASE WHEN t.display_type='rich_menu' THEN COALESCE(mt.count,0) ELSE NULL END AS tap_count
    FROM templates t
    LEFT JOIN hq_template_versions v ON v.id=t.current_version_id
      AND v.tenant_id=t.tenant_id AND v.template_id=t.id
    LEFT JOIN distribution d ON d.template_id=t.id
    LEFT JOIN outdated o ON o.template_id=t.id
    LEFT JOIN sent s ON s.template_id=t.id
    LEFT JOIN tag_population tp ON tp.template_id=t.id
    LEFT JOIN field_population fp ON fp.template_id=t.id
    LEFT JOIN mark_population mp ON mp.template_id=t.id
    LEFT JOIN menu_taps mt ON mt.template_id=t.id
    ORDER BY t.updated_at DESC,t.id
  `).bind(tenantId, type ?? null).all<HqTemplateListSource>();
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
  // SQLite 3.35+ final catch-all ON CONFLICT: id/fingerprintのどちらの競合も、
  // bindingを満たさない場合はWHEREでno-opとなりchanges=0を返す。
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
    idempotencyFingerprint: string;
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
        idempotency_fingerprint, snapshot_token, source_id, item_kind, resolution_mode,
        target_id, alias_name, expected_revision)
     SELECT id, tenant_id, template_id, template_version_id, target_account_id,
            idempotency_fingerprint, snapshot_token, ?, ?, ?, ?, ?, ?
     FROM hq_template_preflights
     WHERE id = ? AND tenant_id = ? AND template_id = ? AND template_version_id = ?
       AND target_account_id = ? AND idempotency_fingerprint = ? AND snapshot_token = ?
       AND status IN ('ready', 'blocked')
     ON CONFLICT(preflight_id, tenant_id, source_id) DO UPDATE SET
       item_kind = excluded.item_kind,
       resolution_mode = excluded.resolution_mode,
       target_id = excluded.target_id,
       alias_name = excluded.alias_name,
       expected_revision = excluded.expected_revision
     WHERE hq_template_preflight_resolutions.template_id = excluded.template_id
       AND hq_template_preflight_resolutions.template_version_id = excluded.template_version_id
       AND hq_template_preflight_resolutions.target_account_id = excluded.target_account_id
       AND hq_template_preflight_resolutions.idempotency_fingerprint = excluded.idempotency_fingerprint
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
    input.idempotencyFingerprint,
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
  // Migration 381's AFTER INSERT trigger consumes the exact preflight in the same
  // SQLite statement. A failed consume raises and rolls this result INSERT back.
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
