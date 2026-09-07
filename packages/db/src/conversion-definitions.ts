import { jstNow } from './utils.js';

export type ConversionDefinitionStatus = 'active' | 'stopped';
export type ConversionDefinitionSort = 'count_desc' | 'value_desc' | 'updated_desc' | 'name_asc';
export type ConversionDefinitionUsageKind =
  | 'affiliate_offer'
  | 'analytics'
  | 'auto_reply'
  | 'scenario'
  | 'nen_campaign'
  | 'mileage_rule'
  | 'automation'
  | 'ad_platform';

export const CONVERSION_DEFINITION_USAGE_KINDS: readonly ConversionDefinitionUsageKind[] = [
  'affiliate_offer',
  'analytics',
  'auto_reply',
  'scenario',
  'nen_campaign',
  'mileage_rule',
  'automation',
  'ad_platform',
];

export type ConversionDefinitionScope = {
  allowedAccountIds: readonly string[];
  includeUnassigned: boolean;
};

export type ConversionDefinitionRange = {
  from: string;
  to: string;
  timeZone: 'Asia/Tokyo';
};

export type ConversionDefinitionListInput = {
  scope: ConversionDefinitionScope;
  lineAccountId?: string;
  query?: string;
  status?: ConversionDefinitionStatus;
  sourceType?: string;
  range: ConversionDefinitionRange;
  cursor: number;
  limit: number;
  sort: ConversionDefinitionSort;
};

export type ConversionDefinitionUsage = {
  id: string;
  conversionPointId: string;
  definitionVersion: number;
  lineAccountId: string;
  refKind: ConversionDefinitionUsageKind;
  refId: string;
  refVersionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** 表示用の利用先名。参照先が未解決の場合はIDを返す。 */
  usageName: string;
};

export type ConversionDefinitionListItem = {
  id: string;
  name: string;
  sourceType: string;
  value: number | null;
  measureMethod: string;
  targetUrl: string | null;
  countRepeat: boolean;
  attributionDays: number | null;
  lineAccountId: string | null;
  status: ConversionDefinitionStatus;
  version: number;
  usageCount: number;
  usageNames: string[];
  metrics: {
    recordedCount: number;
    netCount: number;
    reversedCount: number | null;
    netValue: number;
    reversalState: 'available' | 'unavailable';
    reversalReason: string;
    cancellationCount: number | null;
    cancellationValue: number | null;
  };
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DefinitionRow = {
  id: string;
  name: string;
  event_type: string;
  value: number | null;
  measure_method: string;
  target_url: string | null;
  count_repeat: number;
  attribution_days: number | null;
  line_account_id: string | null;
  status: ConversionDefinitionStatus;
  version: number;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
  recorded_count: number;
  net_value: number;
  usage_count: number;
};

type UsageRow = {
  id: string;
  conversion_point_id: string;
  definition_version: number;
  line_account_id: string;
  ref_kind: ConversionDefinitionUsageKind;
  ref_id: string;
  ref_version_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function usageName(row: { ref_kind: ConversionDefinitionUsageKind; ref_id: string }): string {
  const labels: Record<ConversionDefinitionUsageKind, string> = {
    affiliate_offer: '案件', analytics: '分析', auto_reply: '自動応答', scenario: 'シナリオ',
    nen_campaign: 'NEN配信', mileage_rule: 'マイル', automation: 'オートメーション', ad_platform: '広告連携',
  };
  return `${labels[row.ref_kind] ?? '利用先'}（${row.ref_id}）`;
}

export class ConversionDefinitionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message);
    this.name = 'ConversionDefinitionError';
  }
}

function accountWhere(
  alias: string,
  scope: ConversionDefinitionScope,
  requested: string | undefined,
): { sql: string; values: unknown[] } {
  const column = `${alias}line_account_id`;
  if (requested) {
    return {
      sql: `(${column} = ?${scope.includeUnassigned ? ` OR ${column} IS NULL` : ''})`,
      values: [requested],
    };
  }
  if (scope.allowedAccountIds.length > 0) {
    return {
      sql: `(${column} IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.includeUnassigned ? ` OR ${column} IS NULL` : ''})`,
      values: [...scope.allowedAccountIds],
    };
  }
  return { sql: scope.includeUnassigned ? `${column} IS NULL` : '1 = 0', values: [] };
}

function definitionWhere(
  input: Pick<ConversionDefinitionListInput, 'scope' | 'lineAccountId' | 'query' | 'status' | 'sourceType'>,
  includeStatus = true,
): { sql: string; values: unknown[] } {
  const account = accountWhere('cp.', input.scope, input.lineAccountId);
  const clauses = [account.sql];
  const values = [...account.values];
  const query = input.query?.trim();
  if (query) {
    clauses.push('cp.name LIKE ? ESCAPE \'\\\'');
    values.push(`%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
  }
  if (includeStatus && input.status) {
    clauses.push('cp.status = ?');
    values.push(input.status);
  }
  if (input.sourceType?.trim()) {
    clauses.push('cp.event_type = ?');
    values.push(input.sourceType.trim());
  }
  return { sql: clauses.join(' AND '), values };
}

function metricsCte(range: ConversionDefinitionRange): { sql: string; values: unknown[] } {
  return {
    sql: `WITH period_metrics AS (
      SELECT conversion_point_id,
             COUNT(*) AS recorded_count,
             COALESCE(SUM(COALESCE(value_snapshot, 0)), 0) AS net_value
        FROM conversion_events
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY conversion_point_id
    ), usage_counts AS (
      SELECT conversion_point_id, COUNT(*) AS usage_count
        FROM conversion_definition_usages
       GROUP BY conversion_point_id
    )`,
    values: [range.from, range.to],
  };
}

function selectDefinitionsSql(): string {
  return `SELECT cp.id, cp.name, cp.event_type, cp.value, cp.measure_method, cp.target_url,
                 cp.count_repeat, cp.attribution_days, cp.line_account_id, cp.status,
                 cp.version, cp.stopped_at, cp.created_at, cp.updated_at,
                 COALESCE(pm.recorded_count, 0) AS recorded_count,
                 COALESCE(pm.net_value, 0) AS net_value,
                 COALESCE(uc.usage_count, 0) AS usage_count
            FROM conversion_points cp
       LEFT JOIN period_metrics pm ON pm.conversion_point_id = cp.id
       LEFT JOIN usage_counts uc ON uc.conversion_point_id = cp.id`;
}

function orderBy(sort: ConversionDefinitionSort): string {
  if (sort === 'value_desc') return 'net_value DESC, cp.updated_at DESC, cp.id ASC';
  if (sort === 'name_asc') return 'cp.name ASC, cp.id ASC';
  if (sort === 'updated_desc') return 'cp.updated_at DESC, cp.id ASC';
  return 'recorded_count DESC, cp.updated_at DESC, cp.id ASC';
}

type CancellationMetric = { count: number; value: number };

async function cancellationMetrics(db: D1Database, from: string, to: string): Promise<Map<string, CancellationMetric>> {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('affiliate_adjustments','affiliate_reward_entries')").all<{ name: string }>();
  if (tables.results.length < 2) return new Map();
  const rows = await db.prepare(`SELECT ce.conversion_point_id,
      COUNT(*) AS cancellation_count,
      COALESCE(SUM(ABS(aa.amount_minor)), 0) AS cancellation_value
    FROM affiliate_adjustments aa
    JOIN affiliate_reward_entries re ON re.id = aa.source_entry_id
    JOIN conversion_events ce ON ce.id = re.conversion_event_id
    WHERE aa.reason_type = 'cancel' AND aa.created_at >= ? AND aa.created_at <= ?
    GROUP BY ce.conversion_point_id`).bind(from, to).all<{ conversion_point_id: string; cancellation_count: number; cancellation_value: number }>();
  return new Map(rows.results.map((row) => [row.conversion_point_id, { count: Number(row.cancellation_count), value: Number(row.cancellation_value) }]));
}

function serializeDefinition(row: DefinitionRow, cancellation?: CancellationMetric): ConversionDefinitionListItem {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.event_type,
    value: row.value,
    measureMethod: row.measure_method,
    targetUrl: row.target_url,
    countRepeat: row.count_repeat !== 0,
    attributionDays: row.attribution_days,
    lineAccountId: row.line_account_id,
    status: row.status,
    version: row.version,
    usageCount: Number(row.usage_count),
    usageNames: [],
    metrics: {
      recordedCount: Number(row.recorded_count),
      netCount: Number(row.recorded_count),
      reversedCount: cancellation?.count ?? null,
      netValue: Number(row.net_value) - (cancellation?.value ?? 0),
      reversalState: cancellation ? 'available' : 'unavailable',
      reversalReason: cancellation ? '取消イベント台帳から集計' : '取消イベント台帳はまだ接続されていません',
      cancellationCount: cancellation?.count ?? null,
      cancellationValue: cancellation?.value ?? null,
    },
    stoppedAt: row.stopped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeUsage(row: UsageRow): ConversionDefinitionUsage {
  return {
    id: row.id,
    conversionPointId: row.conversion_point_id,
    definitionVersion: Number(row.definition_version),
    lineAccountId: row.line_account_id,
    refKind: row.ref_kind,
    refId: row.ref_id,
    refVersionId: row.ref_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageName: usageName(row),
  };
}

export async function listConversionDefinitions(db: D1Database, input: ConversionDefinitionListInput) {
  const cte = metricsCte(input.range);
  const where = definitionWhere(input);
  const stateWhere = definitionWhere(input, false);
  const limit = Math.min(100, Math.max(1, input.limit));
  const cursor = Math.max(0, input.cursor);

  const [rows, totalRow, stateRows] = await Promise.all([
    db.prepare(`${cte.sql}
      ${selectDefinitionsSql()}
       WHERE ${where.sql}
       ORDER BY ${orderBy(input.sort)}
       LIMIT ? OFFSET ?`)
      .bind(...cte.values, ...where.values, limit, cursor)
      .all<DefinitionRow>(),
    db.prepare(`SELECT COUNT(*) AS total FROM conversion_points cp WHERE ${where.sql}`)
      .bind(...where.values)
      .first<{ total: number }>(),
    db.prepare(`SELECT cp.status, COUNT(*) AS total
                  FROM conversion_points cp
                 WHERE ${stateWhere.sql}
                 GROUP BY cp.status`)
      .bind(...stateWhere.values)
      .all<{ status: ConversionDefinitionStatus; total: number }>(),
  ]);
  const total = Number(totalRow?.total ?? 0);
  const cancellations = await cancellationMetrics(db, input.range.from, input.range.to);
  const stateCounts = { active: 0, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0 };
  for (const row of stateRows.results) stateCounts[row.status] = Number(row.total);
  const usages = rows.results.length === 0 ? [] : (await db.prepare(`SELECT * FROM conversion_definition_usages WHERE conversion_point_id IN (${rows.results.map(() => '?').join(',')}) ORDER BY created_at DESC, id ASC`).bind(...rows.results.map((row) => row.id)).all<UsageRow>()).results;
  const namesByPoint = new Map<string, string[]>();
  for (const usage of usages) {
    const names = namesByPoint.get(usage.conversion_point_id) ?? [];
    names.push(usageName(usage));
    namesByPoint.set(usage.conversion_point_id, names);
  }
  return {
    items: rows.results.map((row) => ({ ...serializeDefinition(row, cancellations.get(row.id)), usageNames: namesByPoint.get(row.id) ?? [] })),
    stateCounts,
    range: input.range,
    pagination: {
      total,
      limit,
      cursor: String(cursor),
      nextCursor: cursor + limit < total ? String(cursor + limit) : null,
    },
  };
}

export async function getConversionDefinitionDetail(
  db: D1Database,
  id: string,
  scope: ConversionDefinitionScope,
) {
  const account = accountWhere('cp.', scope, undefined);
  const row = await db.prepare(`
    WITH period_metrics AS (
      SELECT conversion_point_id, COUNT(*) AS recorded_count,
             COALESCE(SUM(COALESCE(value_snapshot, 0)), 0) AS net_value
        FROM conversion_events GROUP BY conversion_point_id
    ), usage_counts AS (
      SELECT conversion_point_id, COUNT(*) AS usage_count
        FROM conversion_definition_usages GROUP BY conversion_point_id
    )
    ${selectDefinitionsSql()}
     WHERE cp.id = ? AND ${account.sql}`)
    .bind(id, ...account.values)
    .first<DefinitionRow>();
  if (!row) return null;
  const cancellation = (await cancellationMetrics(db, '0000-01-01', '9999-12-31')).get(row.id);
  const usages = await db.prepare(`SELECT * FROM conversion_definition_usages
    WHERE conversion_point_id = ? ORDER BY created_at DESC, id ASC`)
    .bind(id)
    .all<UsageRow>();
  return {
    ...serializeDefinition(row, cancellation),
    currentVersion: {
      id: `${row.id}:v${row.version}`,
      number: row.version,
      sourceType: row.event_type,
      measureMethod: row.measure_method,
      targetUrl: row.target_url,
      countRepeat: row.count_repeat !== 0,
      fixedValue: row.value,
      attributionDays: row.attribution_days,
      publishedAt: row.created_at,
    },
    usages: usages.results.map(serializeUsage),
    usageNames: usages.results.map(serializeUsage).map((usage) => usage.usageName),
  };
}

export type AddConversionDefinitionUsageInput = {
  conversionPointId: string;
  lineAccountId: string;
  expectedVersion: number;
  refKind: ConversionDefinitionUsageKind;
  refId: string;
  refVersionId?: string | null;
  staffId: string;
};

async function getCurrentMatchingUsage(
  db: D1Database,
  input: AddConversionDefinitionUsageInput,
): Promise<UsageRow | null> {
  return db.prepare(`SELECT u.* FROM conversion_definition_usages u
    JOIN conversion_points cp ON cp.id = u.conversion_point_id
    WHERE u.conversion_point_id = ? AND u.line_account_id = ? AND u.ref_kind = ? AND u.ref_id = ?
      AND COALESCE(u.ref_version_id, '') = COALESCE(?, '')
      AND cp.version = ? AND cp.status = 'active'
      AND (cp.line_account_id IS NULL OR cp.line_account_id = ?)`)
    .bind(
      input.conversionPointId,
      input.lineAccountId,
      input.refKind,
      input.refId,
      input.refVersionId ?? null,
      input.expectedVersion,
      input.lineAccountId,
    )
    .first<UsageRow>();
}

async function throwLatestUsageConflict(
  db: D1Database,
  input: AddConversionDefinitionUsageInput,
): Promise<never> {
  const latest = await db.prepare('SELECT version, status, line_account_id FROM conversion_points WHERE id = ?')
    .bind(input.conversionPointId)
    .first<{ version: number; status: ConversionDefinitionStatus; line_account_id: string | null }>();
  if (!latest || (latest.line_account_id !== null && latest.line_account_id !== input.lineAccountId)) {
    throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  }
  if (latest.status !== 'active') {
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
  if (point.status !== 'active') {
    throw new ConversionDefinitionError('definition_stopped', '停止中の成果地点には利用先を追加できません', 409);
  }
  if (Number(point.version) !== input.expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }

  const existing = await getCurrentMatchingUsage(db, input);
  if (existing) {
    return { created: false, usage: serializeUsage(existing), currentVersion: Number(point.version) };
  }

  const id = crypto.randomUUID();
  const now = jstNow();
  let result: D1Result<unknown>;
  try {
    result = await db.prepare(`INSERT INTO conversion_definition_usages
        (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id,
         ref_version_id, created_by, created_at, updated_at)
      SELECT ?, cp.id, cp.version, ?, ?, ?, ?, ?, ?, ?
        FROM conversion_points cp
       WHERE cp.id = ? AND cp.version = ? AND cp.status = 'active'
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

type ReportRow = {
  conversion_point_id: string;
  conversion_point_name: string;
  event_type: string;
  total_count: number;
  total_value: number;
};

async function reportRows(
  db: D1Database,
  scope: ConversionDefinitionScope,
  lineAccountId: string | undefined,
  from: string,
  to: string,
): Promise<ReportRow[]> {
  const account = accountWhere('cp.', scope, lineAccountId);
  const rows = await db.prepare(`SELECT cp.id AS conversion_point_id,
      cp.name AS conversion_point_name, cp.event_type,
      COUNT(ce.id) AS total_count,
      COALESCE(SUM(CASE WHEN ce.id IS NULL THEN 0 ELSE COALESCE(ce.value_snapshot, 0) END), 0) AS total_value
    FROM conversion_points cp
    LEFT JOIN conversion_events ce ON ce.conversion_point_id = cp.id
      AND ce.created_at >= ? AND ce.created_at <= ?
    WHERE ${account.sql}
    GROUP BY cp.id
    ORDER BY total_count DESC, cp.id ASC`)
    .bind(from, to, ...account.values)
    .all<ReportRow>();
  return rows.results;
}

export async function getConversionDefinitionReport(
  db: D1Database,
  input: {
    scope: ConversionDefinitionScope;
    lineAccountId?: string;
    range: ConversionDefinitionRange;
    previousRange: ConversionDefinitionRange;
  },
) {
  const [current, previous] = await Promise.all([
    reportRows(db, input.scope, input.lineAccountId, input.range.from, input.range.to),
    reportRows(db, input.scope, input.lineAccountId, input.previousRange.from, input.previousRange.to),
  ]);
  const [currentCancellations, previousCancellations] = await Promise.all([
    cancellationMetrics(db, input.range.from, input.range.to),
    cancellationMetrics(db, input.previousRange.from, input.previousRange.to),
  ]);
  const previousById = new Map(previous.map((row) => [row.conversion_point_id, row]));
  const totals = current.reduce((sum, row) => ({
    count: sum.count + Number(row.total_count) - (currentCancellations.get(row.conversion_point_id)?.count ?? 0),
    value: sum.value + Number(row.total_value) - (currentCancellations.get(row.conversion_point_id)?.value ?? 0),
  }), { count: 0, value: 0 });
  const previousTotals = previous.reduce((sum, row) => ({
    count: sum.count + Number(row.total_count) - (previousCancellations.get(row.conversion_point_id)?.count ?? 0),
    value: sum.value + Number(row.total_value) - (previousCancellations.get(row.conversion_point_id)?.value ?? 0),
  }), { count: 0, value: 0 });
  const account = accountWhere('cp.', input.scope, input.lineAccountId);
  const [dailyRows, routeRows] = await Promise.all([
    db.prepare(`SELECT substr(ce.created_at, 1, 10) AS day, cp.id AS conversion_point_id,
                       cp.name AS conversion_point_name, COUNT(*) AS total_count,
                       COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS total_value
                  FROM conversion_events ce
                  JOIN conversion_points cp ON cp.id = ce.conversion_point_id
                 WHERE ce.created_at >= ? AND ce.created_at <= ? AND ${account.sql}
                 GROUP BY day, cp.id ORDER BY day ASC, cp.id ASC`)
      .bind(input.range.from, input.range.to, ...account.values)
      .all<{ day: string; conversion_point_id: string; conversion_point_name: string; total_count: number; total_value: number }>(),
    db.prepare(`SELECT ce.conversion_point_id, COALESCE(ce.attributed_ref_code, 'unattributed') AS route_key,
                       COUNT(*) AS total_count,
                       COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS total_value
                  FROM conversion_events ce
                  JOIN conversion_points cp ON cp.id = ce.conversion_point_id
                 WHERE ce.created_at >= ? AND ce.created_at <= ? AND ${account.sql}
                 GROUP BY ce.conversion_point_id, route_key ORDER BY total_count DESC, route_key ASC`)
      .bind(input.range.from, input.range.to, ...account.values)
      .all<{ conversion_point_id: string; route_key: string; total_count: number; total_value: number }>(),
  ]);
  const routesByDefinition = new Map<string, Array<{ routeKey: string; label: string; attributionState: 'attributed' | 'unattributed'; netCount: number; netValue: number; audience: number | null; conversionRate: number | null }>>();
  for (const row of routeRows.results) {
    const route = { routeKey: row.route_key, label: row.route_key === 'unattributed' ? '未帰属' : row.route_key, attributionState: row.route_key === 'unattributed' ? 'unattributed' as const : 'attributed' as const, netCount: Number(row.total_count), netValue: Number(row.total_value), audience: null, conversionRate: null };
    routesByDefinition.set(row.conversion_point_id, [...(routesByDefinition.get(row.conversion_point_id) ?? []), route]);
  }
  const byDefinition = current.map((row) => {
    const before = previousById.get(row.conversion_point_id);
    return {
      conversionPointId: row.conversion_point_id,
      conversionPointName: row.conversion_point_name,
      sourceType: row.event_type,
      netCount: Number(row.total_count) - (currentCancellations.get(row.conversion_point_id)?.count ?? 0),
      netValue: Number(row.total_value) - (currentCancellations.get(row.conversion_point_id)?.value ?? 0),
      previousNetCount: Number(before?.total_count ?? 0) - (previousCancellations.get(row.conversion_point_id)?.count ?? 0),
      previousNetValue: Number(before?.total_value ?? 0) - (previousCancellations.get(row.conversion_point_id)?.value ?? 0),
      countChange: (Number(row.total_count) - (currentCancellations.get(row.conversion_point_id)?.count ?? 0)) - (Number(before?.total_count ?? 0) - (previousCancellations.get(row.conversion_point_id)?.count ?? 0)),
      cancellationCount: currentCancellations.get(row.conversion_point_id)?.count ?? null,
      cancellationValue: currentCancellations.get(row.conversion_point_id)?.value ?? null,
      routes: routesByDefinition.get(row.conversion_point_id) ?? [],
    };
  });
  const fastestGrowing = byDefinition
    .filter((row) => row.netCount > 0 || row.previousNetCount > 0)
    .sort((a, b) => b.countChange - a.countChange)[0] ?? null;
  return {
    range: input.range,
    previousRange: input.previousRange,
    kpis: {
      recordedCount: totals.count,
      reversedCount: [...currentCancellations.values()].reduce((sum, metric) => sum + metric.count, 0) || null,
      netCount: totals.count,
      netValue: totals.value,
      averageNetValue: totals.count > 0 ? Math.round((totals.value / totals.count) * 100) / 100 : null,
      previousNetCount: previousTotals.count,
      previousNetValue: previousTotals.value,
      countChangeRate: previousTotals.count > 0
        ? Math.round(((totals.count - previousTotals.count) / previousTotals.count) * 10_000) / 100
        : null,
      reversalState: currentCancellations.size > 0 ? 'available' as const : 'unavailable' as const,
      reversalReason: currentCancellations.size > 0 ? '取消イベント台帳から集計' : '取消イベント台帳はまだ接続されていません',
      cancellationCount: [...currentCancellations.values()].reduce((sum, metric) => sum + metric.count, 0) || null,
      cancellationValue: [...currentCancellations.values()].reduce((sum, metric) => sum + metric.value, 0) || null,
      fastestGrowing,
    },
    daily: dailyRows.results.map((row) => ({
      day: row.day,
      conversionPointId: row.conversion_point_id,
      conversionPointName: row.conversion_point_name,
      netCount: Number(row.total_count),
      netValue: Number(row.total_value),
    })),
    byDefinition,
    byRoute: [...routeRows.results].reduce((all, row) => {
      const existing = all.find((item) => item.routeKey === row.route_key);
      if (existing) { existing.netCount += Number(row.total_count); existing.netValue += Number(row.total_value); return all; }
      all.push({
      routeKey: row.route_key,
      label: row.route_key === 'unattributed' ? '未帰属' : row.route_key,
      attributionState: row.route_key === 'unattributed' ? 'unattributed' : 'attributed',
      netCount: Number(row.total_count),
      netValue: Number(row.total_value),
      audience: null,
      conversionRate: null,
      });
      return all;
    }, [] as Array<{ routeKey: string; label: string; attributionState: 'attributed' | 'unattributed'; netCount: number; netValue: number; audience: number | null; conversionRate: number | null }>),
  };
}

export async function listConversionDefinitionsForExport(
  db: D1Database,
  input: Omit<ConversionDefinitionListInput, 'cursor' | 'limit'>,
) {
  const cte = metricsCte(input.range);
  const where = definitionWhere(input);
  const rows = await db.prepare(`${cte.sql}
    ${selectDefinitionsSql()}
     WHERE ${where.sql}
     ORDER BY ${orderBy(input.sort)}
     LIMIT 10000`)
    .bind(...cte.values, ...where.values)
    .all<DefinitionRow>();
  return rows.results.map((row) => serializeDefinition(row));
}
