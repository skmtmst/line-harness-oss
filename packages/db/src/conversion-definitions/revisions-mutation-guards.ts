import { jstNow } from '../utils.js';
import { type ConversionDefinitionScope, type ConversionDefinitionStatus, type RevisionRow, type DefinitionConfig } from './types.js';
import { getConversionDefinitionDetail, accountWhere, ConversionDefinitionError } from './reads.js';



export async function getConversionDefinitionDeleteImpact(
  db: D1Database,
  id: string,
  scope: ConversionDefinitionScope,
) {
  const definition = await getConversionDefinitionDetail(db, id, scope);
  if (!definition) return null;
  const eventRow = await db.prepare('SELECT COUNT(*) AS total FROM conversion_events WHERE conversion_point_id = ?')
    .bind(id).first<{ total: number }>();
  const account = accountWhere('cp.', scope, undefined);
  /*
   * N-261: 差替え候補は同じ種類の成果地点だけを出す。
   * 起点の種類・計測方法・対象URLが違う地点へ利用先を移すと、
   * 利用先が見ているものと別の意味の成果を数え始める。
   * 候補一覧が本実行と同じ条件で絞られていれば、画面で違う種類を
   * 選ぶこと自体が起きない。
   */
  const replacements = await db.prepare(`SELECT cp.id, cp.name, cp.version
    FROM conversion_points cp
    WHERE cp.id <> ? AND cp.status = 'active'
      AND cp.event_type = ? AND cp.measure_method = ? AND cp.target_url IS ?
      AND ${account.sql}
    ORDER BY cp.name ASC LIMIT 20`)
    .bind(
      id,
      definition.sourceType,
      definition.measureMethod,
      definition.targetUrl,
      ...account.values,
    )
    .all<{ id: string; name: string; version: number }>();
  const eventCount = Number(eventRow?.total ?? 0);
  return {
    definition,
    usages: definition.usages,
    eventCount,
    canDelete: definition.usages.length === 0 && eventCount === 0,
    stopImpact: {
      affectedUsageCount: definition.usages.length,
      preservesPastEvents: true,
      preservesUsages: true,
    },
    replacementCandidates: replacements.results.map((row) => ({
      id: row.id, name: row.name, version: Number(row.version),
    })),
  };
}

export async function currentDefinitionForMutation(
  db: D1Database,
  id: string,
  scope: ConversionDefinitionScope,
): Promise<{
  id: string; version: number; status: ConversionDefinitionStatus;
  line_account_id: string | null;
  event_type: string; measure_method: string; target_url: string | null;
} | null> {
  const account = accountWhere('cp.', scope, undefined);
  return db.prepare(`SELECT cp.id, cp.version, cp.status, cp.line_account_id,
      cp.event_type, cp.measure_method, cp.target_url
    FROM conversion_points cp WHERE cp.id = ? AND ${account.sql}`)
    .bind(id, ...account.values)
    .first();
}

export function requireExpectedDefinition(
  row: { version: number; status: ConversionDefinitionStatus } | null,
  expectedVersion: number,
  options?: { allowDraft?: boolean },
) {
  if (!row) throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  if (Number(row.version) !== expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  if (row.status === 'stopped') {
    throw new ConversionDefinitionError('definition_stopped', '成果地点はすでに停止しています', 409);
  }
  if (row.status === 'draft' && !options?.allowDraft) {
    throw new ConversionDefinitionError('definition_draft', '成果地点はまだ下書きです。公開してから操作してください', 409);
  }
}

export async function stopConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; reason?: string | null; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  requireExpectedDefinition(current, input.expectedVersion, { allowDraft: true });
  const now = jstNow();
  const usageRow = await db.prepare('SELECT COUNT(*) AS total FROM conversion_definition_usages WHERE conversion_point_id = ?')
    .bind(input.id).first<{ total: number }>();
  const operationId = crypto.randomUUID();
  // D1 batchは1文でも失敗すれば全体をrollbackする。CAS直後のchangesが1の
  // ときだけログを作るため、競合したbatchは副作用0のまま終わる。
  const results = await db.batch([
    db.prepare(`UPDATE conversion_points SET status = 'stopped', stopped_at = ?,
      updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status IN ('active', 'draft')`)
      .bind(now, now, input.id, input.expectedVersion),
    db.prepare(`INSERT INTO conversion_definition_operations
      (id, conversion_point_id, action, replacement_id, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, 'stop', NULL, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(operationId, input.id, Number(usageRow?.total ?? 0), input.reason ?? null, input.staffId, now),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, status: 'stopped' as const, version: input.expectedVersion + 1, stoppedAt: now };
}

export function configOf(row: RevisionRow): DefinitionConfig {
  return {
    name: row.name,
    sourceType: row.event_type,
    sourceConfig: JSON.parse(row.source_config_json || '{}') as Record<string, unknown>,
    measureMethod: row.measure_method,
    targetUrl: row.target_url,
    deduplicationMode: row.deduplication_mode,
    deduplicationWindowDays: row.deduplication_window_days,
    valueMode: row.value_mode,
    fixedValue: row.value,
    reversalPolicy: row.reversal_policy,
    attributionDays: row.attribution_days,
  };
}
