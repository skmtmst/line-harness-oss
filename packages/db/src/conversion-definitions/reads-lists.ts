import { type ConversionDefinitionScope, type ConversionDefinitionListInput, type DefinitionRow, type UsageRow } from './types.js';
import { metricsCte, definitionWhere, selectDefinitionsSql, orderBy, cancellationMetrics, reversalMetrics, deriveDefinitionState, usageName, serializeDefinition, accountWhere, serializeUsage } from './reads-query-parts.js';


export async function listConversionDefinitions(db: D1Database, input: ConversionDefinitionListInput) {
  const where = definitionWhere(input);
  const cte = metricsCte(input.range, where);
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
    /*
     * N-267/N-268: 状態の内訳は「絞り込み全体」から導出する。表示頁の行だけ
     * 数えると打ち切りでずれるため、状態判定に足りる列だけを全件ぶん引いて
     * JS で数える(件数は成果地点数なので実用上の上限内に収まる)。
     */
    db.prepare(`SELECT cp.status, cp.measure_method, cp.target_url, cp.value,
                       cp.value_mode, cp.deduplication_mode, cp.deduplication_window_days,
                       cp.ingest_disabled_at,
                       EXISTS(SELECT 1 FROM conversion_definition_usages u
                               WHERE u.conversion_point_id = cp.id) AS has_usage
                  FROM conversion_points cp
                 WHERE ${stateWhere.sql}`)
      .bind(...stateWhere.values)
      .all<Pick<DefinitionRow, 'status' | 'measure_method' | 'target_url' | 'value' | 'value_mode'
        | 'deduplication_mode' | 'deduplication_window_days' | 'ingest_disabled_at'>
        & { has_usage: number }>(),
  ]);
  const total = Number(totalRow?.total ?? 0);
  const [cancellations, reversals] = await Promise.all([
    cancellationMetrics(db, input.range.from, input.range.to, rows.results.map(row => row.id)),
    reversalMetrics(db, input.range.from, input.range.to, rows.results.map(row => row.id)),
  ]);
  const stateCounts = { active: 0, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0, unused: 0 };
  for (const row of stateRows.results) {
    stateCounts[deriveDefinitionState(row).state] += 1;
    if (!row.has_usage) stateCounts.unused += 1;
  }
  const usages = rows.results.length === 0 ? [] : (await db.prepare(`SELECT * FROM conversion_definition_usages WHERE conversion_point_id IN (${rows.results.map(() => '?').join(',')}) ORDER BY created_at DESC, id ASC`).bind(...rows.results.map((row) => row.id)).all<UsageRow>()).results;
  const namesByPoint = new Map<string, string[]>();
  for (const usage of usages) {
    const names = namesByPoint.get(usage.conversion_point_id) ?? [];
    names.push(usageName(usage));
    namesByPoint.set(usage.conversion_point_id, names);
  }
  return {
    items: rows.results.map((row) => ({ ...serializeDefinition(row, cancellations.get(row.id), reversals.get(row.id)), usageNames: namesByPoint.get(row.id) ?? [] })),
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
        FROM conversion_events WHERE conversion_point_id = ? GROUP BY conversion_point_id
    ), usage_counts AS (
      SELECT conversion_point_id, COUNT(*) AS usage_count
        FROM conversion_definition_usages WHERE conversion_point_id = ? GROUP BY conversion_point_id
    )
    ${selectDefinitionsSql()}
     WHERE cp.id = ? AND ${account.sql}`)
    .bind(id, id, id, ...account.values)
    .first<DefinitionRow>();
  if (!row) return null;
  const [cancellations, reversals] = await Promise.all([
    cancellationMetrics(db, '0000-01-01', '9999-12-31', [id]),
    reversalMetrics(db, '0000-01-01', '9999-12-31', [id]),
  ]);
  const cancellation = cancellations.get(row.id);
  const reversal = reversals.get(row.id);
  const usages = await db.prepare(`SELECT * FROM conversion_definition_usages
    WHERE conversion_point_id = ? ORDER BY created_at DESC, id ASC`)
    .bind(id)
    .all<UsageRow>();
  return {
    ...serializeDefinition(row, cancellation, reversal),
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
