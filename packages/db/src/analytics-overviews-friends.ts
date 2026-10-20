import { analyticsWindow, analyticsWindowWhere } from './utils.js';
import { type EventCoverage, type AnalyticsMetricState, type AnalyticsOverviewContext } from './analytics-overviews-types.js';
import { addUtcDays, envelope, metric } from './analytics-overviews-metrics.js';


export function dateInTimeZone(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('analytics_overview_time_invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function hourInTimeZone(value: string, timeZone: string): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('analytics_overview_time_invalid');
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).find((item) => item.type === 'hour')?.value;
  return Number(hour ?? 0);
}

export async function getCoverage(
  db: D1Database,
  lineAccountId: string,
  eventType: string,
  requiredFrom: string,
): Promise<EventCoverage> {
  const row = await db.prepare(
    `SELECT available_from, state, reason FROM analytics_event_coverage
      WHERE line_account_id = ? AND event_type = ?`,
  ).bind(lineAccountId, eventType).first<{
    available_from: string;
    state: 'available' | 'partial' | 'unavailable' | 'failed';
    reason: string | null;
  }>();
  if (!row) {
    return { state: 'unavailable', reason: `${eventType} の記録が未接続です`, availableFrom: null };
  }
  if (row.state === 'failed') {
    return { state: 'failed', reason: row.reason || `${eventType} の集計に失敗しました`, availableFrom: row.available_from };
  }
  if (row.state === 'unavailable') {
    return { state: 'unavailable', reason: row.reason || `${eventType} を取得できません`, availableFrom: row.available_from };
  }
  if (row.state === 'partial' || row.available_from > requiredFrom) {
    return {
      state: 'partial',
      reason: row.reason || `${row.available_from} 以降の履歴のみです`,
      availableFrom: row.available_from,
    };
  }
  return { state: 'available', reason: null, availableFrom: row.available_from };
}

export function combineState(coverages: EventCoverage[]): { state: AnalyticsMetricState; reason: string | null } {
  const failed = coverages.find((item) => item.state === 'failed');
  if (failed) return { state: failed.state, reason: failed.reason };
  const unavailable = coverages.find((item) => item.state === 'unavailable');
  if (unavailable) return { state: unavailable.state, reason: unavailable.reason };
  const partial = coverages.filter((item) => item.state === 'partial');
  return partial.length
    ? { state: 'partial', reason: partial.map((item) => item.reason).filter(Boolean).join(' / ') }
    : { state: 'available', reason: null };
}

export async function getAnalyticsFriendsOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
) {
  const win = analyticsWindow(context.from, context.toExclusive);
  const [addCoverage, unfollowCoverage, current, addTotals, dailyRows, reconciliation, campaigns] = await Promise.all([
    getCoverage(db, context.lineAccountId, 'friend_add', context.from),
    getCoverage(db, context.lineAccountId, 'friend_unfollow', context.from),
    db.prepare(
      `SELECT COUNT(*) AS count FROM friends
        WHERE line_account_id = ? AND is_following = 1 AND is_hidden = 0`,
    ).bind(context.lineAccountId).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN friend_kind = 'first_time' THEN 1 ELSE 0 END) AS first_time,
              SUM(CASE WHEN friend_kind = 'returning' THEN 1 ELSE 0 END) AS returning_count
         FROM friend_add_events
        WHERE line_account_id = ?
          ${analyticsWindowWhere('occurred_at')}`,
    ).bind(context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso).first<{
      total: number; first_time: number | null; returning_count: number | null;
    }>(),
    db.prepare(
      `SELECT metric_date, dimension_value, numerator, state, data_cutoff_at
         FROM analytics_daily_metrics
        WHERE line_account_id = ? AND metric_date >= ? AND metric_date <= ?
          AND metric_key = 'event_total'
          AND dimension_key = 'event_type'
          AND dimension_value IN ('friend_add','friend_unfollow')
        ORDER BY metric_date, dimension_value`,
    ).bind(context.lineAccountId, context.fromDate, context.toDate).all<{
      metric_date: string; dimension_value: string; numerator: number | null;
      state: AnalyticsMetricState; data_cutoff_at: string;
    }>(),
    db.prepare(
      `SELECT status, completed_at FROM analytics_reconciliation_runs
        WHERE line_account_id = ? AND range_from <= ? AND range_to >= ?
        ORDER BY completed_at DESC LIMIT 1`,
    ).bind(context.lineAccountId, context.fromDate, context.toDate).first<{
      status: 'matched' | 'mismatched' | 'failed'; completed_at: string;
    }>(),
    loadCampaignMarkers(db, context),
  ]);

  const state = combineState([addCoverage, unfollowCoverage]);
  const byDate = new Map<string, { added: number; removed: number }>();
  for (const row of dailyRows.results) {
    const item = byDate.get(row.metric_date) ?? { added: 0, removed: 0 };
    if (row.dimension_value === 'friend_add') item.added += Number(row.numerator ?? 0);
    else item.removed += Number(row.numerator ?? 0);
    byDate.set(row.metric_date, item);
  }
  const days: Array<{ date: string; added: number; removed: number; net: number }> = [];
  for (let date = context.fromDate; date <= context.toDate; date = addUtcDays(date, 1)) {
    const item = byDate.get(date) ?? { added: 0, removed: 0 };
    days.push({ date, ...item, net: item.added - item.removed });
  }
  const added = days.reduce((sum, day) => sum + day.added, 0);
  const removed = days.reduce((sum, day) => sum + day.removed, 0);
  const projectedUntil = dailyRows.results.reduce(
    (latest, row) => row.data_cutoff_at > latest ? row.data_cutoff_at : latest,
    '',
  );
  const hasCompletedProjection = Boolean(projectedUntil || reconciliation);
  const projectionState: AnalyticsMetricState = !hasCompletedProjection
    ? 'pending'
    : reconciliation?.status === 'failed'
      ? 'failed'
      : reconciliation?.status === 'mismatched'
        ? 'partial'
        : state.state;
  const projectionReason = !hasCompletedProjection
    ? '日別集計の初回更新を待っています'
    : reconciliation?.status === 'failed'
      ? '日別集計に失敗しました'
      : reconciliation?.status === 'mismatched'
        ? '元の記録と日別集計に差があります'
        : state.reason;
  return envelope(context, {
    state: projectionState,
    stateReason: projectionReason,
    metrics: {
      added: metric(added, projectionState, projectionReason),
      removed: metric(removed, projectionState, projectionReason),
      net: metric(added - removed, projectionState, projectionReason),
      currentFriends: metric(Number(current?.count ?? 0)),
      firstTime: metric(Number(addTotals?.first_time ?? 0), addCoverage.state, addCoverage.reason),
      returning: metric(Number(addTotals?.returning_count ?? 0), addCoverage.state, addCoverage.reason),
    },
    days,
    campaigns,
    historyAvailableFrom: [addCoverage.availableFrom, unfollowCoverage.availableFrom]
      .filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
  });
}

export async function loadCampaignMarkers(db: D1Database, context: AnalyticsOverviewContext) {
  const win = analyticsWindow(context.from, context.toExclusive);
  const [broadcasts, scenarios] = await Promise.all([
    db.prepare(
      `SELECT id, title AS name, sent_at AS occurred_at
         FROM broadcasts
        WHERE line_account_id = ? AND sent_at IS NOT NULL
          ${analyticsWindowWhere('sent_at')}`,
    ).bind(context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso)
      .all<{ id: string; name: string; occurred_at: string }>(),
    db.prepare(
      `SELECT s.id, s.name, MIN(m.created_at) AS occurred_at
         FROM messages_log m JOIN scenario_steps ss ON ss.id = m.scenario_step_id
         JOIN scenarios s ON s.id = ss.scenario_id
        WHERE m.line_account_id = ? AND m.direction = 'outgoing'
          ${analyticsWindowWhere('m.created_at')}
        GROUP BY s.id, s.name`,
    ).bind(context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso)
      .all<{ id: string; name: string; occurred_at: string }>(),
  ]);
  return [
    ...broadcasts.results.map((row) => ({
      id: row.id, name: row.name, kind: 'broadcast' as const,
      occurredAt: row.occurred_at, date: dateInTimeZone(row.occurred_at, context.timeZone),
    })),
    ...scenarios.results.map((row) => ({
      id: row.id, name: row.name, kind: 'scenario' as const,
      occurredAt: row.occurred_at, date: dateInTimeZone(row.occurred_at, context.timeZone),
    })),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
