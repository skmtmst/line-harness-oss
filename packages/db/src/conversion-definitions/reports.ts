import { readFolderAssignment, FolderAssignmentError } from '../folder-assignment.js';
import { type ReportLedgers, type ConversionDefinitionScope, type ReportRow, type ConversionReport, type ConversionDefinitionRange, type ConversionDefinitionListInput, type ConversionDefinitionListItem, type DefinitionRow } from './types.js';
import { accountWhere, metricsCte, definitionWhere, selectDefinitionsSql, orderBy, serializeDefinition, ConversionDefinitionError } from './reads.js';


/** 取消台帳の接続状況。無い環境(移行前)では取消判定を0に倒す。 */
export async function reportLedgerAvailability(db: D1Database): Promise<ReportLedgers> {
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('affiliate_adjustments','affiliate_reward_entries','conversion_event_reversals')")
    .all<{ name: string }>();
  const names = new Set(tables.results.map((row) => row.name));
  return {
    affiliate: names.has('affiliate_adjustments') && names.has('affiliate_reward_entries'),
    reversals: names.has('conversion_event_reversals'),
  };
}

/**
 * R284/R285: 取消の正本は「成果単位」の判定にする。
 * 報酬の取消調整が付いた成果、または取消台帳の最新が 'reverse' の成果を
 * 取消扱いにする(再計上 = 最新が 'restore' は数え直しに戻る)。
 * 判定はイベント一覧と同じ定義で、期間の区切りは成果の発生日(ce.created_at)、
 * 範囲の絞りは成果地点の所属(cp.line_account_id)でかける。
 * 合計・日別・地点別・経路別はすべてこの同じ集合から引く。
 */
export function cancelledEventPredicate(ledgers: ReportLedgers): string {
  const parts: string[] = [];
  if (ledgers.affiliate) {
    parts.push(`EXISTS(SELECT 1 FROM affiliate_reward_entries re
              JOIN affiliate_adjustments aa ON aa.source_entry_id = re.id
             WHERE re.conversion_event_id = ce.id AND aa.reason_type = 'cancel')`);
  }
  if (ledgers.reversals) {
    parts.push(`EXISTS(SELECT 1 FROM conversion_event_reversals r
             WHERE r.conversion_event_id = ce.id AND r.kind = 'reverse'
               AND NOT EXISTS (SELECT 1 FROM conversion_event_reversals newer
                                WHERE newer.conversion_event_id = r.conversion_event_id
                                  AND (newer.created_at > r.created_at
                                    OR (newer.created_at = r.created_at AND newer.rowid > r.rowid))))`);
  }
  return parts.length > 0 ? `(${parts.join(' OR ')})` : '0';
}

export async function reportRows(
  db: D1Database,
  scope: ConversionDefinitionScope | null,
  lineAccountId: string | undefined,
  from: string,
  to: string,
  cancelledSql: string,
): Promise<ReportRow[]> {
  const account = scope ? accountWhere('cp.', scope, lineAccountId) : { sql: '1 = 1', values: [] as unknown[] };
  const rows = await db.prepare(`SELECT cp.id AS conversion_point_id,
      cp.name AS conversion_point_name, cp.event_type,
      COUNT(ce.id) AS total_count,
      COALESCE(SUM(CASE WHEN ce.id IS NULL THEN 0 ELSE COALESCE(ce.value_snapshot, 0) END), 0) AS total_value,
      COALESCE(SUM(CASE WHEN ce.id IS NOT NULL AND ${cancelledSql} THEN 1 ELSE 0 END), 0) AS cancelled_count,
      COALESCE(SUM(CASE WHEN ${cancelledSql} THEN COALESCE(ce.value_snapshot, 0) ELSE 0 END), 0) AS cancelled_value
    FROM conversion_points cp
    LEFT JOIN conversion_events ce ON ce.conversion_point_id = cp.id
      AND substr(ce.created_at, 1, 10) >= ? AND substr(ce.created_at, 1, 10) <= ?
    WHERE ${account.sql}
    GROUP BY cp.id
    ORDER BY total_count DESC, cp.id ASC`)
    .bind(from.slice(0, 10), to.slice(0, 10), ...account.values)
    .all<ReportRow>();
  return rows.results;
}

/**
 * N-269: 旧来の地点別集計(startDate/endDate→地点別行)の薄い互換口。
 *
 * 集計は新レポートと同じ `reportRows` を使うため、暦日の解釈
 * (先頭10文字のJST暦日)とスナップショット固定は新レポートと一致する。
 * `total_*` は取消を引く前の総数で、旧形の「全件数えた値」と同じ意味。
 * scope を省略したときはアカウント絞りを掛けない(旧口の呼び出し互換)。
 */
export async function getConversionReport(
  db: D1Database,
  opts: { startDate?: string; endDate?: string; scope?: ConversionDefinitionScope } = {},
): Promise<ConversionReport[]> {
  const ledgers = await reportLedgerAvailability(db);
  const rows = await reportRows(
    db,
    opts.scope ?? null,
    undefined,
    opts.startDate ? `${opts.startDate} 00:00:00` : '0001-01-01 00:00:00',
    opts.endDate ? `${opts.endDate} 23:59:59` : '9999-12-31 23:59:59',
    cancelledEventPredicate(ledgers),
  );
  return rows.map((row) => ({
    conversionPointId: row.conversion_point_id,
    conversionPointName: row.conversion_point_name,
    eventType: row.event_type,
    totalCount: Number(row.total_count),
    totalValue: Number(row.total_value),
  }));
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
  const ledgers = await reportLedgerAvailability(db);
  const cancelledSql = cancelledEventPredicate(ledgers);
  const [current, previous] = await Promise.all([
    reportRows(db, input.scope, input.lineAccountId, input.range.from, input.range.to, cancelledSql),
    reportRows(db, input.scope, input.lineAccountId, input.previousRange.from, input.previousRange.to, cancelledSql),
  ]);
  const sumTotals = (rows: ReportRow[]) => rows.reduce((sum, row) => ({
    count: sum.count + Number(row.total_count),
    value: sum.value + Number(row.total_value),
    cancelledCount: sum.cancelledCount + Number(row.cancelled_count),
    cancelledValue: sum.cancelledValue + Number(row.cancelled_value),
  }), { count: 0, value: 0, cancelledCount: 0, cancelledValue: 0 });
  const totals = sumTotals(current);
  const previousTotals = sumTotals(previous);
  const net = {
    count: totals.count - totals.cancelledCount,
    value: totals.value - totals.cancelledValue,
  };
  const previousNet = {
    count: previousTotals.count - previousTotals.cancelledCount,
    value: previousTotals.value - previousTotals.cancelledValue,
  };
  const previousById = new Map(previous.map((row) => [row.conversion_point_id, row]));
  const account = accountWhere('cp.', input.scope, input.lineAccountId);
  // N-265: 経路別の母数。ref_tracking に残る「その経路を踏んだ友だち数」を
  // 分母にする。created_at は JST ISO(+09:00)と datetime 書式が混在するため、
  // 保存された暦日の先頭10文字で日単位に比較する(N-269 と同じ扱い)。
  const friendAccount = accountWhere('f.', input.scope, input.lineAccountId);
  const [dailyRows, routeRows, audienceRows] = await Promise.all([
    db.prepare(`SELECT substr(ce.created_at, 1, 10) AS day, cp.id AS conversion_point_id,
                       cp.name AS conversion_point_name, COUNT(*) AS total_count,
                       COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS total_value,
                       COALESCE(SUM(CASE WHEN ${cancelledSql} THEN 1 ELSE 0 END), 0) AS cancelled_count,
                       COALESCE(SUM(CASE WHEN ${cancelledSql} THEN COALESCE(ce.value_snapshot, 0) ELSE 0 END), 0) AS cancelled_value
                  FROM conversion_events ce
                  JOIN conversion_points cp ON cp.id = ce.conversion_point_id
                 WHERE substr(ce.created_at, 1, 10) >= ? AND substr(ce.created_at, 1, 10) <= ? AND ${account.sql}
                 GROUP BY day, cp.id ORDER BY day ASC, cp.id ASC`)
      .bind(input.range.from.slice(0, 10), input.range.to.slice(0, 10), ...account.values)
      .all<{ day: string; conversion_point_id: string; conversion_point_name: string; total_count: number; total_value: number; cancelled_count: number; cancelled_value: number }>(),
    db.prepare(`SELECT ce.conversion_point_id, COALESCE(ce.attributed_ref_code, 'unattributed') AS route_key,
                       COUNT(*) AS total_count,
                       COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS total_value,
                       COALESCE(SUM(CASE WHEN ${cancelledSql} THEN 1 ELSE 0 END), 0) AS cancelled_count,
                       COALESCE(SUM(CASE WHEN ${cancelledSql} THEN COALESCE(ce.value_snapshot, 0) ELSE 0 END), 0) AS cancelled_value
                  FROM conversion_events ce
                  JOIN conversion_points cp ON cp.id = ce.conversion_point_id
                 WHERE substr(ce.created_at, 1, 10) >= ? AND substr(ce.created_at, 1, 10) <= ? AND ${account.sql}
                 GROUP BY ce.conversion_point_id, route_key ORDER BY total_count DESC, route_key ASC`)
      .bind(input.range.from.slice(0, 10), input.range.to.slice(0, 10), ...account.values)
      .all<{ conversion_point_id: string; route_key: string; total_count: number; total_value: number; cancelled_count: number; cancelled_value: number }>(),
    db.prepare(`SELECT rt.ref_code, COUNT(DISTINCT rt.friend_id) AS audience
                  FROM ref_tracking rt
                  JOIN friends f ON f.id = rt.friend_id
                 WHERE substr(rt.created_at, 1, 10) >= ? AND substr(rt.created_at, 1, 10) <= ?
                   AND ${friendAccount.sql}
                 GROUP BY rt.ref_code`)
      .bind(input.range.from.slice(0, 10), input.range.to.slice(0, 10), ...friendAccount.values)
      .all<{ ref_code: string; audience: number }>(),
  ]);
  const audienceByRoute = new Map(audienceRows.results.map((row) => [row.ref_code, Number(row.audience)]));
  const routeMetric = (routeKey: string, netCount: number) => {
    // 未帰属には母数が無い。帰属ありでも期間内の記録がなければ null のまま
    // 返し、画面が「母数の記録なし」と理由を出せるようにする。
    if (routeKey === 'unattributed') return { audience: null, conversionRate: null };
    const audience = audienceByRoute.get(routeKey) ?? null;
    return {
      audience,
      conversionRate: audience !== null && audience > 0
        ? Math.round((netCount / audience) * 1000) / 10
        : null,
    };
  };
  const routesByDefinition = new Map<string, Array<{ routeKey: string; label: string; attributionState: 'attributed' | 'unattributed'; netCount: number; netValue: number; audience: number | null; conversionRate: number | null }>>();
  for (const row of routeRows.results) {
    const netCount = Number(row.total_count) - Number(row.cancelled_count);
    const netValue = Number(row.total_value) - Number(row.cancelled_value);
    const route = { routeKey: row.route_key, label: row.route_key === 'unattributed' ? '未帰属' : row.route_key, attributionState: row.route_key === 'unattributed' ? 'unattributed' as const : 'attributed' as const, netCount, netValue, ...routeMetric(row.route_key, netCount) };
    routesByDefinition.set(row.conversion_point_id, [...(routesByDefinition.get(row.conversion_point_id) ?? []), route]);
  }
  const byDefinition = current.map((row) => {
    const before = previousById.get(row.conversion_point_id);
    const cancelledCount = Number(row.cancelled_count);
    const cancelledValue = Number(row.cancelled_value);
    const beforeCancelledCount = Number(before?.cancelled_count ?? 0);
    const beforeCancelledValue = Number(before?.cancelled_value ?? 0);
    const netCount = Number(row.total_count) - cancelledCount;
    const netValue = Number(row.total_value) - cancelledValue;
    const beforeNetCount = Number(before?.total_count ?? 0) - beforeCancelledCount;
    const beforeNetValue = Number(before?.total_value ?? 0) - beforeCancelledValue;
    return {
      conversionPointId: row.conversion_point_id,
      conversionPointName: row.conversion_point_name,
      sourceType: row.event_type,
      netCount,
      netValue,
      previousNetCount: beforeNetCount,
      previousNetValue: beforeNetValue,
      countChange: netCount - beforeNetCount,
      cancellationCount: cancelledCount > 0 ? cancelledCount : null,
      cancellationValue: cancelledValue > 0 ? cancelledValue : null,
      routes: routesByDefinition.get(row.conversion_point_id) ?? [],
    };
  });
  const fastestGrowing = byDefinition
    .filter((row) => row.netCount > 0 || row.previousNetCount > 0)
    .sort((a, b) => b.countChange - a.countChange)[0] ?? null;
  const ledgersConnected = ledgers.affiliate || ledgers.reversals;
  return {
    range: input.range,
    previousRange: input.previousRange,
    kpis: {
      // R284: recorded は取消前の総数。純数(net)とは別に持つ。
      recordedCount: totals.count,
      recordedValue: totals.value,
      reversedCount: totals.cancelledCount || null,
      netCount: net.count,
      netValue: net.value,
      averageNetValue: net.count > 0 ? Math.round((net.value / net.count) * 100) / 100 : null,
      previousNetCount: previousNet.count,
      previousNetValue: previousNet.value,
      countChangeRate: previousNet.count > 0
        ? Math.round(((net.count - previousNet.count) / previousNet.count) * 10_000) / 100
        : null,
      reversalState: ledgersConnected ? 'available' as const : 'unavailable' as const,
      reversalReason: ledgersConnected ? '取消イベント台帳から集計' : '取消イベント台帳はまだ接続されていません',
      cancellationCount: totals.cancelledCount || null,
      cancellationValue: totals.cancelledValue || null,
      fastestGrowing,
    },
    daily: dailyRows.results.map((row) => ({
      day: row.day,
      conversionPointId: row.conversion_point_id,
      conversionPointName: row.conversion_point_name,
      netCount: Number(row.total_count) - Number(row.cancelled_count),
      netValue: Number(row.total_value) - Number(row.cancelled_value),
    })),
    byDefinition,
    byRoute: [...routeRows.results].reduce((all, row) => {
      const netCount = Number(row.total_count) - Number(row.cancelled_count);
      const netValue = Number(row.total_value) - Number(row.cancelled_value);
      const existing = all.find((item) => item.routeKey === row.route_key);
      if (existing) {
        existing.netCount += netCount;
        existing.netValue += netValue;
        const metric = routeMetric(row.route_key, existing.netCount);
        existing.audience = metric.audience;
        existing.conversionRate = metric.conversionRate;
        return all;
      }
      all.push({
      routeKey: row.route_key,
      label: row.route_key === 'unattributed' ? '未帰属' : row.route_key,
      attributionState: row.route_key === 'unattributed' ? 'unattributed' : 'attributed',
      netCount,
      netValue,
      ...routeMetric(row.route_key, netCount),
      });
      return all;
    }, [] as Array<{ routeKey: string; label: string; attributionState: 'attributed' | 'unattributed'; netCount: number; netValue: number; audience: number | null; conversionRate: number | null }>),
  };
}

export async function listConversionDefinitionsForExport(
  db: D1Database,
  input: Omit<ConversionDefinitionListInput, 'cursor' | 'limit'>,
): Promise<{ items: ConversionDefinitionListItem[]; truncated: boolean }> {
  const where = definitionWhere(input);
  const cte = metricsCte(input.range, where);
  // N-267: 上限そのもの(10000)ではなく +1 件まで読み、切れたことを確実に
  // 検出して呼び出し側へ返す。黙って切るとCSVが未完の一覧に見える。
  const rows = await db.prepare(`${cte.sql}
    ${selectDefinitionsSql()}
     WHERE ${where.sql}
     ORDER BY ${orderBy(input.sort)}
     LIMIT 10001`)
    .bind(...cte.values, ...where.values)
    .all<DefinitionRow>();
  const truncated = rows.results.length > 10000;
  const items = truncated ? rows.results.slice(0, 10000) : rows.results;
  return { items: items.map((row) => serializeDefinition(row)), truncated };
}

/** 広告費の分母。確定済みで取り消されていない成果だけを数える。 */
export async function getConfirmedConversionCount(db: D1Database, input: {lineAccountId: string; from: string; to: string}): Promise<number> {
  const cancelled = cancelledEventPredicate(await reportLedgerAvailability(db));
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM conversion_events ce
    JOIN conversion_points cp ON cp.id = ce.conversion_point_id
    JOIN friends f ON f.id = ce.friend_id
    WHERE cp.line_account_id = ? AND f.line_account_id = ?
      AND (ce.approval_status IS NULL OR ce.approval_status = 'approved')
      AND julianday(ce.created_at) >= julianday(?) AND julianday(ce.created_at) < julianday(?, '+1 day')
      AND NOT ${cancelled}`)
    .bind(input.lineAccountId, input.lineAccountId, `${input.from}T00:00:00+09:00`, `${input.to}T00:00:00+09:00`).first<{count: number}>();
  return Number(row?.count ?? 0);
}

export async function conversionFolder(db: D1Database, accountId: string | null, value: unknown) {
  try { return await readFolderAssignment(db, 'conversion', accountId, value); }
  catch (error) {
    if (error instanceof FolderAssignmentError) throw new ConversionDefinitionError(error.code, error.message, 400);
    throw error;
  }
}

export type { ConversionReport } from './types.js';
