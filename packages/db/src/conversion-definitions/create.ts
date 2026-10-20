import { jstNow } from '../utils.js';
import { resolveConversionPointTenantId } from '../conversions/index.js';
import { type AddConversionDefinitionUsageInput, type UsageRow, type ConversionDefinitionStatus, type ConversionDefinitionUsage, type CreateConversionDefinitionInput } from './types.js';
import { ConversionDefinitionError, serializeUsage, assertUsageRefExists, getConversionDefinitionDetail } from './reads.js';
import { conversionFolder } from './reports.js';


export async function getCurrentMatchingUsage(
  db: D1Database,
  input: AddConversionDefinitionUsageInput,
): Promise<UsageRow | null> {
  return db.prepare(`SELECT u.* FROM conversion_definition_usages u
    JOIN conversion_points cp ON cp.id = u.conversion_point_id
    WHERE u.conversion_point_id = ? AND u.line_account_id = ? AND u.ref_kind = ? AND u.ref_id = ?
      AND COALESCE(u.ref_version_id, '') = COALESCE(?, '')
      AND cp.version = ? AND (cp.status = 'active' OR ? = 1)
      AND (cp.line_account_id IS NULL OR cp.line_account_id = ?)`)
    .bind(
      input.conversionPointId,
      input.lineAccountId,
      input.refKind,
      input.refId,
      input.refVersionId ?? null,
      input.expectedVersion,
      input.allowInactive ? 1 : 0,
      input.lineAccountId,
    )
    .first<UsageRow>();
}

export async function throwLatestUsageConflict(
  db: D1Database,
  input: AddConversionDefinitionUsageInput,
): Promise<never> {
  const latest = await db.prepare('SELECT version, status, line_account_id FROM conversion_points WHERE id = ?')
    .bind(input.conversionPointId)
    .first<{ version: number; status: ConversionDefinitionStatus; line_account_id: string | null }>();
  if (!latest || (latest.line_account_id !== null && latest.line_account_id !== input.lineAccountId)) {
    throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  }
  if (latest.status !== 'active' && !input.allowInactive) {
    throw new ConversionDefinitionError('definition_stopped', '停止中の成果地点には利用先を追加できません', 409);
  }
  if (Number(latest.version) !== input.expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  throw new Error('conversion_definition_usage_insert_failed');
}

export async function addConversionDefinitionUsage(
  db: D1Database,
  input: AddConversionDefinitionUsageInput,
): Promise<{ created: boolean; usage: ConversionDefinitionUsage; currentVersion: number }> {
  const point = await db.prepare('SELECT version, status, line_account_id FROM conversion_points WHERE id = ?')
    .bind(input.conversionPointId)
    .first<{ version: number; status: ConversionDefinitionStatus; line_account_id: string | null }>();
  if (!point || (point.line_account_id !== null && point.line_account_id !== input.lineAccountId)) {
    throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  }
  if (point.status !== 'active' && !input.allowInactive) {
    throw new ConversionDefinitionError('definition_stopped', '停止中の成果地点には利用先を追加できません', 409);
  }
  if (Number(point.version) !== input.expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }

  const existing = await getCurrentMatchingUsage(db, input);
  if (existing) {
    return { created: false, usage: serializeUsage(existing), currentVersion: Number(point.version) };
  }

  // N-258: 実在しない・別アカウントの利用先は保存しない。
  await assertUsageRefExists(db, input, input.lineAccountId);

  const id = crypto.randomUUID();
  const now = jstNow();
  let result: D1Result<unknown>;
  try {
    result = await db.prepare(`INSERT INTO conversion_definition_usages
        (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id,
         ref_version_id, created_by, created_at, updated_at)
      SELECT ?, cp.id, cp.version, ?, ?, ?, ?, ?, ?, ?
        FROM conversion_points cp
       WHERE cp.id = ? AND cp.version = ? AND (cp.status = 'active' OR ? = 1)
         AND (cp.line_account_id IS NULL OR cp.line_account_id = ?)`)
      .bind(
        id,
        input.lineAccountId,
        input.refKind,
        input.refId,
        input.refVersionId ?? null,
        input.staffId,
        now,
        now,
        input.conversionPointId,
        input.expectedVersion,
        input.allowInactive ? 1 : 0,
        input.lineAccountId,
      )
      .run();
  } catch (error) {
    if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) throw error;
    const winner = await getCurrentMatchingUsage(db, input);
    if (winner) {
      return { created: false, usage: serializeUsage(winner), currentVersion: input.expectedVersion };
    }
    return throwLatestUsageConflict(db, input);
  }
  if ((result.meta.changes ?? 0) === 0) {
    return throwLatestUsageConflict(db, input);
  }
  const usage = await db.prepare('SELECT * FROM conversion_definition_usages WHERE id = ?')
    .bind(id)
    .first<UsageRow>();
  if (!usage) throw new Error('conversion_definition_usage_insert_failed');
  return { created: true, usage: serializeUsage(usage), currentVersion: input.expectedVersion };
}

export async function createConversionDefinition(
  db: D1Database,
  input: CreateConversionDefinitionInput,
) {
  const folderId = await conversionFolder(db, input.lineAccountId, input.folderId);
  const duplicate = await db.prepare(`SELECT id FROM conversion_points
    WHERE line_account_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1`)
    .bind(input.lineAccountId, input.name)
    .first<{ id: string }>();
  if (duplicate) {
    throw new ConversionDefinitionError('duplicate_name', '同じ名前の成果地点があります', 409);
  }
  // N-258: 実在しない・別アカウントの利用先を仮IDのまま保存しない。
  for (const usage of input.usages) {
    await assertUsageRefExists(db, usage, input.lineAccountId);
  }
  const id = crypto.randomUUID();
  const now = jstNow();
  const tenantId = await resolveConversionPointTenantId(db, input.lineAccountId);
  const value = input.valueMode === 'fixed' ? input.fixedValue ?? null : null;
  const statements = [
    db.prepare(`INSERT INTO conversion_points
      (id, name, event_type, value, measure_method, target_url, count_repeat,
       attribution_days, line_account_id, tenant_id, source_config_json, deduplication_mode,
       deduplication_window_days, value_mode, reversal_policy, status, created_at, updated_at, folder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id, input.name, input.sourceType, value, input.measureMethod,
        input.measureMethod === 'url_reach' ? input.targetUrl ?? null : null,
        input.deduplicationMode === 'every' ? 1 : 0,
        input.attributionDays ?? null, input.lineAccountId, tenantId, JSON.stringify(input.sourceConfig),
        input.deduplicationMode, input.deduplicationMode === 'window'
          ? input.deduplicationWindowDays ?? null : null,
        input.valueMode, input.reversalPolicy, input.draft ? 'draft' : 'active', now, now, folderId ?? null,
      ),
    ...input.usages.map((usage) => db.prepare(`INSERT INTO conversion_definition_usages
      (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id,
       ref_version_id, created_by, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(), id, input.lineAccountId, usage.refKind, usage.refId,
        usage.refVersionId ?? null, input.staffId, now, now,
      )),
  ];
  await db.batch(statements);
  return getConversionDefinitionDetail(db, id, {
    allowedAccountIds: [input.lineAccountId], includeUnassigned: false,
  });
}
