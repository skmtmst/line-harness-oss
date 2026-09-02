import { getTrackedLinkStats } from './analytics.js';

export type AnalyticsMetricState =
  | 'available'
  | 'pending'
  | 'unavailable'
  | 'insufficient'
  | 'partial'
  | 'failed';

export interface AnalyticsMetric<T> {
  value: T | null;
  state: AnalyticsMetricState;
  reason: string | null;
}

export interface AnalyticsOverviewContext {
  lineAccountId: string;
  timeZone: string;
  fromDate: string;
  toDate: string;
  from: string;
  toExclusive: string;
  dataCutoffAt: string;
}

interface ReactionCampaign {
  id: string;
  name: string;
  kind: 'broadcast' | 'scenario';
  sentAt: string;
  targetPeople: AnalyticsMetric<number>;
  delivered: AnalyticsMetric<number>;
  opened: AnalyticsMetric<number>;
  lineClicked: AnalyticsMetric<number>;
  outcomes: AnalyticsMetric<number>;
  fetchedAt: string | null;
}

interface AnalyticsRouteOverviewItem {
  id: string;
  refCode: string | null;
  name: string;
  clicks: AnalyticsMetric<number>;
  friendAdds: AnalyticsMetric<number>;
  currentFriends: AnalyticsMetric<number>;
  reactionPeople: AnalyticsMetric<number>;
  conversions: {
    approved: AnalyticsMetric<number>;
    pending: AnalyticsMetric<number>;
    rejected: AnalyticsMetric<number>;
    revenue: AnalyticsMetric<number>;
  };
  adCost: AnalyticsMetric<number>;
  costPerFriend: AnalyticsMetric<number>;
  costPerConversion: AnalyticsMetric<number>;
  profitAfterAdCost: AnalyticsMetric<number>;
}

interface EventCoverage {
  state: AnalyticsMetricState;
  reason: string | null;
  availableFrom: string | null;
}

function metric<T>(
  value: T | null,
  state: AnalyticsMetricState = 'available',
  reason: string | null = null,
): AnalyticsMetric<T> {
  return { value, state, reason };
}

function dateInTimeZone(value: string, timeZone: string): string {
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

function hourInTimeZone(value: string, timeZone: string): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('analytics_overview_time_invalid');
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).find((item) => item.type === 'hour')?.value;
  return Number(hour ?? 0);
}

async function getCoverage(
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

function combineState(coverages: EventCoverage[]): { state: AnalyticsMetricState; reason: string | null } {
  const failed = coverages.find((item) => item.state === 'failed');
  if (failed) return { state: failed.state, reason: failed.reason };
  const unavailable = coverages.find((item) => item.state === 'unavailable');
  if (unavailable) return { state: unavailable.state, reason: unavailable.reason };
  const partial = coverages.filter((item) => item.state === 'partial');
  return partial.length
    ? { state: 'partial', reason: partial.map((item) => item.reason).filter(Boolean).join(' / ') }
    : { state: 'available', reason: null };
}

function envelope<T>(context: AnalyticsOverviewContext, data: T) {
  return {
    lineAccountId: context.lineAccountId,
    timeZone: context.timeZone,
    period: { from: context.fromDate, to: context.toDate },
    dataCutoffAt: context.dataCutoffAt,
    data,
  };
}

export async function getAnalyticsFriendsOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
) {
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
          AND julianday(occurred_at) >= julianday(?)
          AND julianday(occurred_at) < julianday(?)`,
    ).bind(context.lineAccountId, context.from, context.toExclusive).first<{
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

async function loadCampaignMarkers(db: D1Database, context: AnalyticsOverviewContext) {
  const [broadcasts, scenarios] = await Promise.all([
    db.prepare(
      `SELECT id, title AS name, sent_at AS occurred_at
         FROM broadcasts
        WHERE line_account_id = ? AND sent_at IS NOT NULL
          AND julianday(sent_at) >= julianday(?) AND julianday(sent_at) < julianday(?)`,
    ).bind(context.lineAccountId, context.from, context.toExclusive)
      .all<{ id: string; name: string; occurred_at: string }>(),
    db.prepare(
      `SELECT s.id, s.name, MIN(m.created_at) AS occurred_at
         FROM messages_log m JOIN scenario_steps ss ON ss.id = m.scenario_step_id
         JOIN scenarios s ON s.id = ss.scenario_id
        WHERE m.line_account_id = ? AND m.direction = 'outgoing'
          AND julianday(m.created_at) >= julianday(?) AND julianday(m.created_at) < julianday(?)
        GROUP BY s.id, s.name`,
    ).bind(context.lineAccountId, context.from, context.toExclusive)
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

export async function getAnalyticsReactionsOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
) {
  const [broadcastRows, scenarioRows, clickRows, outcomeCoverage] = await Promise.all([
    db.prepare(
      `SELECT b.id, b.title, b.sent_at, b.total_count, b.success_count,
              i.delivered, i.unique_impression, i.unique_click, i.status AS insight_status,
              i.fetched_at
         FROM broadcasts b
         LEFT JOIN broadcast_insights i ON i.id = (
           SELECT bi.id FROM broadcast_insights bi WHERE bi.broadcast_id = b.id
            ORDER BY bi.created_at DESC, bi.id DESC LIMIT 1
         )
        WHERE b.line_account_id = ? AND b.sent_at IS NOT NULL
          AND julianday(b.sent_at) >= julianday(?) AND julianday(b.sent_at) < julianday(?)
        ORDER BY b.sent_at DESC, b.id DESC LIMIT 200`,
    ).bind(context.lineAccountId, context.from, context.toExclusive).all<{
      id: string; title: string; sent_at: string; total_count: number; success_count: number;
      delivered: number | null; unique_impression: number | null; unique_click: number | null;
      insight_status: 'pending' | 'ready' | 'failed' | null; fetched_at: string | null;
    }>(),
    db.prepare(
      `SELECT s.id, s.name, MIN(m.created_at) AS sent_at,
              COUNT(*) AS sent_count, COUNT(DISTINCT m.friend_id) AS target_count
         FROM messages_log m JOIN scenario_steps ss ON ss.id = m.scenario_step_id
         JOIN scenarios s ON s.id = ss.scenario_id
        WHERE m.line_account_id = ? AND m.direction = 'outgoing'
          AND julianday(m.created_at) >= julianday(?) AND julianday(m.created_at) < julianday(?)
        GROUP BY s.id, s.name ORDER BY sent_at DESC LIMIT 200`,
    ).bind(context.lineAccountId, context.from, context.toExclusive).all<{
      id: string; name: string; sent_at: string; sent_count: number; target_count: number;
    }>(),
    db.prepare(
      `SELECT c.clicked_at
         FROM link_clicks c JOIN tracked_links l ON l.id = c.tracked_link_id
        WHERE l.line_account_id = ?
          AND julianday(c.clicked_at) >= julianday(?) AND julianday(c.clicked_at) < julianday(?)
        ORDER BY c.clicked_at LIMIT 50001`,
    ).bind(context.lineAccountId, context.from, context.toExclusive).all<{ clicked_at: string }>(),
    getCoverage(db, context.lineAccountId, 'conversion_approved', context.from),
  ]);

  const campaigns: ReactionCampaign[] = broadcastRows.results.map((row) => {
    const insufficient = row.success_count > 0 && row.success_count < 20;
    const insightState: AnalyticsMetricState = insufficient
      ? 'insufficient'
      : row.insight_status === 'ready'
        ? 'available'
        : row.insight_status === 'failed'
          ? 'failed'
          : 'pending';
    const reason = insufficient
      ? 'LINEの集計対象人数が20人未満です'
      : insightState === 'pending'
        ? 'LINEの配信実績を取得中です'
        : insightState === 'failed'
          ? 'LINEの配信実績を取得できませんでした'
          : null;
    return {
      id: row.id,
      name: row.title,
      kind: 'broadcast' as const,
      sentAt: row.sent_at,
      targetPeople: metric(Number(row.total_count ?? 0)),
      delivered: metric(row.delivered == null ? null : Number(row.delivered), insightState, reason),
      opened: metric(row.unique_impression == null ? null : Number(row.unique_impression), insightState, reason),
      lineClicked: metric(row.unique_click == null ? null : Number(row.unique_click), insightState, reason),
      outcomes: metric<number>(null, outcomeCoverage.state, outcomeCoverage.reason),
      fetchedAt: row.fetched_at,
    };
  });
  campaigns.push(...scenarioRows.results.map((row) => ({
    id: row.id,
    name: row.name,
    kind: 'scenario' as const,
    sentAt: row.sent_at,
    targetPeople: metric(Number(row.target_count ?? 0)),
    delivered: metric(Number(row.sent_count ?? 0)),
    opened: metric<number>(null, 'unavailable', 'シナリオ配信はLINE Insightsの配信単位を持ちません'),
    lineClicked: metric<number>(null, 'unavailable', 'シナリオ配信はLINE Insightsの配信単位を持ちません'),
    outcomes: metric<number>(null, outcomeCoverage.state, outcomeCoverage.reason),
    fetchedAt: null,
  })));

  const trackedClickLimitExceeded = clickRows.results.length > 50_000;
  const visibleClicks = clickRows.results.slice(0, 50_000);
  const clickHours = Array.from({ length: 24 }, (_, hour) => ({ hour, clicks: 0 }));
  for (const row of visibleClicks) clickHours[hourInTimeZone(row.clicked_at, context.timeZone)].clicks += 1;
  const unavailableCampaigns = campaigns.filter((item) =>
    item.opened.state !== 'available' || item.lineClicked.state !== 'available').length;
  const sumMetric = (field: 'targetPeople' | 'delivered' | 'opened' | 'lineClicked') => {
    const values = campaigns.map((item) => item[field]);
    if (values.length === 0) return metric(0);
    const known = values.filter((item) => item.value !== null);
    const state: AnalyticsMetricState = known.length === values.length
      ? 'available'
      : known.length > 0 ? 'partial' : (values[0]?.state ?? 'unavailable');
    return metric(
      known.length ? known.reduce((sum, item) => sum + Number(item.value), 0) : null,
      state,
      state === 'partial'
        ? '取得できた配信だけを合計しています'
        : values.find((item) => item.reason)?.reason ?? null,
    );
  };
  return envelope(context, {
    metrics: {
      sent: sumMetric('targetPeople'),
      delivered: sumMetric('delivered'),
      opened: sumMetric('opened'),
      lineClicked: sumMetric('lineClicked'),
      trackedClicks: metric(
        visibleClicks.length,
        trackedClickLimitExceeded ? 'partial' : 'available',
        trackedClickLimitExceeded ? '5万件までの時間帯を表示しています' : null,
      ),
      unavailableCampaigns: metric(unavailableCampaigns),
    },
    campaigns: campaigns.sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
    trackedClickHours: clickHours,
    clickDefinition: '自社計測URLが実際にクリックされた時間',
  });
}

export async function getAnalyticsRoutesOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
) {
  const rows = await db.prepare(
    `WITH ranked_touch AS (
       SELECT friend_id, entry_route_id, ref_code, occurred_at,
              ROW_NUMBER() OVER (
                PARTITION BY friend_id ORDER BY julianday(occurred_at), id
              ) AS row_number
         FROM friend_add_events WHERE line_account_id = ?
     ), first_touch AS (
       SELECT friend_id, entry_route_id, ref_code, occurred_at
         FROM ranked_touch WHERE row_number = 1
     ), account_routes AS (
       SELECT entry_route_id AS route_id FROM friend_add_events
        WHERE line_account_id = ? AND entry_route_id IS NOT NULL
       UNION SELECT entry_route_id FROM friend_add_attribution_candidates
        WHERE line_account_id = ? AND entry_route_id IS NOT NULL
       UNION SELECT er.id FROM conversion_events ce
         JOIN friends f ON f.id = ce.friend_id
         JOIN entry_routes er ON er.ref_code = ce.attributed_ref_code
        WHERE f.line_account_id = ?
     ), clicks AS (
       SELECT entry_route_id AS route_id, COUNT(*) AS count
         FROM friend_add_attribution_candidates
        WHERE line_account_id = ? AND entry_route_id IS NOT NULL
          AND julianday(occurred_at) >= julianday(?) AND julianday(occurred_at) < julianday(?)
        GROUP BY entry_route_id
     ), adds AS (
       SELECT entry_route_id AS route_id, COUNT(*) AS count
         FROM friend_add_events
        WHERE line_account_id = ? AND entry_route_id IS NOT NULL
          AND julianday(occurred_at) >= julianday(?) AND julianday(occurred_at) < julianday(?)
        GROUP BY entry_route_id
     ), connected AS (
       SELECT ft.entry_route_id AS route_id, COUNT(*) AS count
         FROM first_touch ft JOIN friends f ON f.id = ft.friend_id
        WHERE f.line_account_id = ? AND f.is_following = 1 AND f.is_hidden = 0
        GROUP BY ft.entry_route_id
     ), reactions AS (
       SELECT ft.entry_route_id AS route_id, COUNT(DISTINCT a.friend_id) AS count
         FROM first_touch ft JOIN analytics_events a ON a.friend_id = ft.friend_id
        WHERE a.line_account_id = ?
          AND a.event_type IN ('message_received','postback_received','url_clicked')
          AND julianday(a.occurred_at) >= julianday(?) AND julianday(a.occurred_at) < julianday(?)
        GROUP BY ft.entry_route_id
     ), conversions AS (
       SELECT er.id AS route_id,
              SUM(CASE WHEN COALESCE(ce.approval_status,'approved') = 'approved' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN ce.approval_status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN ce.approval_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN COALESCE(ce.approval_status,'approved') = 'approved'
                       THEN COALESCE(cp.value,0) ELSE 0 END) AS revenue
         FROM conversion_events ce JOIN friends f ON f.id = ce.friend_id
         JOIN conversion_points cp ON cp.id = ce.conversion_point_id
         JOIN entry_routes er ON er.ref_code = ce.attributed_ref_code
        WHERE f.line_account_id = ?
          AND julianday(ce.created_at) >= julianday(?) AND julianday(ce.created_at) < julianday(?)
        GROUP BY er.id
     )
     SELECT er.id, er.ref_code, er.name,
            COALESCE(c.count,0) AS clicks, COALESCE(a.count,0) AS friend_adds,
            COALESCE(n.count,0) AS connected, COALESCE(r.count,0) AS reactions,
            COALESCE(cv.approved,0) AS approved, COALESCE(cv.pending,0) AS pending,
            COALESCE(cv.rejected,0) AS rejected, COALESCE(cv.revenue,0) AS revenue
       FROM account_routes ar JOIN entry_routes er ON er.id = ar.route_id
       LEFT JOIN clicks c ON c.route_id = er.id LEFT JOIN adds a ON a.route_id = er.id
       LEFT JOIN connected n ON n.route_id = er.id LEFT JOIN reactions r ON r.route_id = er.id
       LEFT JOIN conversions cv ON cv.route_id = er.id
      ORDER BY friend_adds DESC, clicks DESC, er.name`,
  ).bind(
    context.lineAccountId,
    context.lineAccountId, context.lineAccountId, context.lineAccountId,
    context.lineAccountId, context.from, context.toExclusive,
    context.lineAccountId, context.from, context.toExclusive,
    context.lineAccountId,
    context.lineAccountId, context.from, context.toExclusive,
    context.lineAccountId, context.from, context.toExclusive,
  ).all<{
    id: string; ref_code: string; name: string; clicks: number; friend_adds: number;
    connected: number; reactions: number; approved: number; pending: number;
    rejected: number; revenue: number;
  }>();
  const [missing, attribution] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS adds FROM friend_add_events
        WHERE line_account_id = ? AND attribution_status = 'unavailable'
          AND julianday(occurred_at) >= julianday(?) AND julianday(occurred_at) < julianday(?)`,
    ).bind(context.lineAccountId, context.from, context.toExclusive).first<{ adds: number }>(),
    getCoverage(db, context.lineAccountId, 'friend_add', context.from),
  ]);
  const costReason = '広告費の取込台帳は「18 流入と計測」で接続予定です';
  const routes: AnalyticsRouteOverviewItem[] = rows.results.map((row) => ({
    id: row.id,
    refCode: row.ref_code,
    name: row.name,
    clicks: metric(Number(row.clicks), 'partial', 'ログイン・LIFF・短縮リンクで識別できた接触のみです'),
    friendAdds: metric(Number(row.friend_adds), attribution.state, attribution.reason),
    currentFriends: metric(Number(row.connected), attribution.state, attribution.reason),
    reactionPeople: metric(Number(row.reactions), 'partial', '記録開始後の受信・ボタン・URL反応です'),
    conversions: {
      approved: metric(Number(row.approved)),
      pending: metric(Number(row.pending)),
      rejected: metric(Number(row.rejected)),
      revenue: metric(Number(row.revenue)),
    },
    adCost: metric<number>(null, 'unavailable', costReason),
    costPerFriend: metric<number>(null, 'unavailable', costReason),
    costPerConversion: metric<number>(null, 'unavailable', costReason),
    profitAfterAdCost: metric<number>(null, 'unavailable', costReason),
  }));
  if (Number(missing?.adds ?? 0) > 0) {
    routes.push({
      id: '__unknown__', refCode: null, name: '経路不明',
      clicks: metric<number>(null, 'unavailable', '中継リンクを通っていないため取得できません'),
      friendAdds: metric(Number(missing?.adds ?? 0), attribution.state, attribution.reason),
      currentFriends: metric<number>(null, 'partial', '過去の第一接触を完全には復元できません'),
      reactionPeople: metric<number>(null, 'partial', '第一接触が不明なため経路へ帰属できません'),
      conversions: {
        approved: metric<number>(null, 'partial', '第一接触が不明なため経路へ帰属できません'),
        pending: metric<number>(null, 'partial', '第一接触が不明なため経路へ帰属できません'),
        rejected: metric<number>(null, 'partial', '第一接触が不明なため経路へ帰属できません'),
        revenue: metric<number>(null, 'partial', '第一接触が不明なため経路へ帰属できません'),
      },
      adCost: metric<number>(null, 'unavailable', costReason),
      costPerFriend: metric<number>(null, 'unavailable', costReason),
      costPerConversion: metric<number>(null, 'unavailable', costReason),
      profitAfterAdCost: metric<number>(null, 'unavailable', costReason),
    });
  }
  return envelope(context, {
    attributionModel: 'first_touch',
    attributionLabel: '第一接触',
    routes,
    searchConsoleHref: '/search-console',
  });
}

export async function getAnalyticsUrlClicksOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
  limit = 200,
) {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const inclusiveTo = new Date(new Date(context.toExclusive).getTime() - 1).toISOString();
  const [allStats, coverage] = await Promise.all([
    getTrackedLinkStats(
      db,
      context.lineAccountId,
      { from: context.from, to: inclusiveTo },
      safeLimit + 1,
    ),
    db.prepare(
      `SELECT available_from, state, reason
         FROM analytics_event_coverage
        WHERE line_account_id = ? AND event_type = 'url_exposed'`,
    ).bind(context.lineAccountId).first<{
      available_from: string;
      state: 'available' | 'partial' | 'unavailable' | 'failed';
      reason: string | null;
    }>(),
  ]);
  const hasMore = allStats.length > safeLimit;
  const stats = allStats.slice(0, safeLimit);

  const exposureByLink = new Map<string, {
    messages: number;
    deliveredPeople: number;
    clickedPeople: number;
    unknownAudiences: number;
    firstSentAt: string | null;
    lastSentAt: string | null;
    sourceKinds: string[];
  }>();
  if (stats.length > 0) {
    for (let offset = 0; offset < stats.length; offset += 90) {
      const chunk = stats.slice(offset, offset + 90);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await db
        .prepare(
          `SELECT e.tracked_link_id,
              COUNT(*) AS messages,
              COUNT(DISTINCT e.friend_id) AS delivered_people,
              COUNT(DISTINCT CASE WHEN e.friend_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM link_clicks c
                 WHERE c.tracked_link_id = e.tracked_link_id
                   AND c.friend_id = e.friend_id
                   AND julianday(c.clicked_at) >= julianday(e.sent_at)
                   AND julianday(c.clicked_at) >= julianday(?)
                   AND julianday(c.clicked_at) < julianday(?)
              ) THEN e.friend_id END) AS clicked_people,
              SUM(CASE WHEN e.audience_state = 'unknown' THEN 1 ELSE 0 END) AS unknown_audiences,
              MIN(e.sent_at) AS first_sent_at,
              MAX(e.sent_at) AS last_sent_at,
              GROUP_CONCAT(DISTINCT e.source_kind) AS source_kinds
         FROM analytics_url_exposures e
        WHERE e.line_account_id = ?
          AND julianday(e.sent_at) >= julianday(?)
          AND julianday(e.sent_at) < julianday(?)
          AND e.tracked_link_id IN (${placeholders})
        GROUP BY e.tracked_link_id`,
        )
        .bind(
          context.from,
          context.toExclusive,
          context.lineAccountId,
          context.from,
          context.toExclusive,
          ...chunk.map((item) => item.trackedLinkId),
        )
        .all<{
          tracked_link_id: string;
          messages: number;
          delivered_people: number;
          clicked_people: number;
          unknown_audiences: number;
          first_sent_at: string | null;
          last_sent_at: string | null;
          source_kinds: string | null;
        }>();
      for (const row of rows.results) {
        exposureByLink.set(row.tracked_link_id, {
          messages: Number(row.messages ?? 0),
          deliveredPeople: Number(row.delivered_people ?? 0),
          clickedPeople: Number(row.clicked_people ?? 0),
          unknownAudiences: Number(row.unknown_audiences ?? 0),
          firstSentAt: row.first_sent_at,
          lastSentAt: row.last_sent_at,
          sourceKinds: row.source_kinds?.split(',').filter(Boolean) ?? [],
        });
      }
    }
  }

  let exposureState: AnalyticsMetricState;
  let exposureReason: string | null;
  if (!coverage) {
    exposureState = 'unavailable';
    exposureReason = 'URLが届いた人数の記録をまだ開始していません';
  } else if (coverage.state === 'failed') {
    exposureState = 'failed';
    exposureReason = coverage.reason || 'URLが届いた人数の集計に失敗しました';
  } else if (coverage.state === 'unavailable') {
    exposureState = 'unavailable';
    exposureReason = coverage.reason || 'URLが届いた人数を取得できません';
  } else if (
    coverage.state === 'partial'
    || new Date(coverage.available_from).getTime() > new Date(context.from).getTime()
  ) {
    exposureState = 'partial';
    exposureReason = coverage.reason || `${coverage.available_from} 以降に送ったURLだけを集計しています`;
  } else {
    exposureState = 'available';
    exposureReason = null;
  }

  const links = stats.map((item) => {
    const exposure = exposureByLink.get(item.trackedLinkId) ?? {
      messages: 0,
      deliveredPeople: 0,
      clickedPeople: 0,
      unknownAudiences: 0,
      firstSentAt: null,
      lastSentAt: null,
      sourceKinds: [],
    };
    const exposureValueAllowed = exposureState === 'available' || exposureState === 'partial';
    const unknownOnly = exposure.unknownAudiences > 0 && exposure.deliveredPeople === 0;
    const hasUnknownAudience = exposure.unknownAudiences > 0;
    const deliveredState: AnalyticsMetricState = !exposureValueAllowed
      ? exposureState
      : unknownOnly
        ? 'unavailable'
        : hasUnknownAudience
          ? 'partial'
          : exposureState;
    const deliveredReason = unknownOnly
      ? 'LINEの全員配信は受信者一覧を取得できないため、届いた人数を算出できません'
      : hasUnknownAudience
        ? '受信者一覧を取得できないLINE全員配信を含むため、確認できた人数のみです'
        : exposureReason;
    const deliveredValue = exposureValueAllowed && !unknownOnly ? exposure.deliveredPeople : null;
    const rateState: AnalyticsMetricState = !exposureValueAllowed
      ? exposureState
      : hasUnknownAudience
        ? unknownOnly ? 'unavailable' : 'partial'
      : exposure.deliveredPeople === 0
        ? exposureState === 'partial' ? 'partial' : 'insufficient'
        : exposureState;
    const rateReason = !exposureValueAllowed
      ? exposureReason
      : hasUnknownAudience
        ? deliveredReason
      : exposure.deliveredPeople === 0
        ? exposureState === 'partial'
          ? exposureReason
          : 'この期間にURLが届いた友だちはいません'
        : exposureReason;
    return {
      trackedLinkId: item.trackedLinkId,
      name: item.name,
      originalUrl: item.originalUrl,
      shortCode: item.shortCode,
      isActive: item.isActive,
      actions: { tagName: item.tagName, scenarioName: item.scenarioName },
      clicks: metric(item.clicks),
      knownClickPeople: metric(item.uniqueFriends),
      deliveredPeople: metric(deliveredValue, deliveredState, deliveredReason),
      exposureMessages: metric(exposureValueAllowed ? exposure.messages : null, exposureState, exposureReason),
      clickedAfterExposurePeople: metric(
        exposureValueAllowed && !unknownOnly ? exposure.clickedPeople : null,
        deliveredState,
        deliveredReason,
      ),
      clickRate: metric(
        exposure.deliveredPeople > 0 && exposureValueAllowed
          ? exposure.clickedPeople / exposure.deliveredPeople
          : null,
        rateState,
        rateReason,
      ),
      firstClickedAt: metric(
        item.firstClickedAt,
        item.firstClickedAt ? 'available' : 'insufficient',
        item.firstClickedAt ? null : 'この期間のクリックはありません',
      ),
      lastClickedAt: metric(
        item.lastClickedAt,
        item.lastClickedAt ? 'available' : 'insufficient',
        item.lastClickedAt ? null : 'この期間のクリックはありません',
      ),
      firstSentAt: metric(
        exposureValueAllowed ? exposure.firstSentAt : null,
        exposure.firstSentAt && exposureValueAllowed ? exposureState : rateState,
        exposure.firstSentAt && exposureValueAllowed ? exposureReason : rateReason,
      ),
      lastSentAt: metric(
        exposureValueAllowed ? exposure.lastSentAt : null,
        exposure.lastSentAt && exposureValueAllowed ? exposureState : rateState,
        exposure.lastSentAt && exposureValueAllowed ? exposureReason : rateReason,
      ),
      usageLocations: exposure.sourceKinds,
    };
  });
  return envelope(context, {
    state: exposureState,
    stateReason: exposureReason,
    exposureAvailableFrom: coverage?.available_from ?? null,
    links,
    hasMore,
    clickRateDefinition: '期間内にURLが届いた友だちのうち、送信後にクリックした友だちの割合',
  });
}

interface UsageCategoryInput {
  key: string;
  label: string;
  href: string;
  created: number | null;
  inUse: number | null;
  lastUsedAt: string | null;
  state?: AnalyticsMetricState;
  reason?: string | null;
}

function usageCategory(input: UsageCategoryInput) {
  const state = input.state ?? 'available';
  const reason = input.reason ?? null;
  const unused = input.created == null || input.inUse == null
    ? null : Math.max(0, input.created - input.inUse);
  return {
    key: input.key,
    label: input.label,
    href: input.href,
    created: metric(input.created, state, reason),
    inUse: metric(input.inUse, state, reason),
    unused: metric(unused, state, reason),
    brokenReferences: metric<number>(null, 'partial', 'JSON内の参照切れは次の利用関係台帳で追加します'),
    lastUsedAt: metric(input.lastUsedAt, state, reason),
  };
}

export async function getAnalyticsUsageOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
) {
  const [templates, scenarios, forms, richMenus, tagsFields, inflow, automations, mediaVars, activity] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS created,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM messages_log m
                    WHERE m.template_id_at_send = t.id AND m.line_account_id = ?) OR
                  EXISTS (SELECT 1 FROM auto_replies a
                    WHERE a.template_id = t.id AND a.line_account_id = ?) OR
                  EXISTS (SELECT 1 FROM scenario_steps ss JOIN scenarios s ON s.id = ss.scenario_id
                    WHERE ss.template_id = t.id AND s.line_account_id = ?)
                THEN 1 ELSE 0 END) AS in_use,
              (SELECT MAX(m.created_at) FROM messages_log m
                WHERE m.line_account_id = ? AND m.template_id_at_send IS NOT NULL) AS last_used_at
         FROM templates t WHERE t.line_account_id = ?`,
    ).bind(...Array(5).fill(context.lineAccountId)).first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT COUNT(*) AS created,
              SUM(CASE WHEN s.is_active = 1 OR EXISTS (
                SELECT 1 FROM friend_scenarios fs JOIN friends f ON f.id = fs.friend_id
                 WHERE fs.scenario_id = s.id AND f.line_account_id = ?
              ) THEN 1 ELSE 0 END) AS in_use,
              (SELECT MAX(m.created_at) FROM messages_log m JOIN scenario_steps ss ON ss.id = m.scenario_step_id
                JOIN scenarios sx ON sx.id = ss.scenario_id WHERE m.line_account_id = ?) AS last_used_at
         FROM scenarios s WHERE s.line_account_id = ?`,
    ).bind(...Array(3).fill(context.lineAccountId)).first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT fs.form_id) AS created,
              COUNT(DISTINCT CASE WHEN fs.id IS NOT NULL THEN fs.form_id END) AS in_use,
              MAX(fs.created_at) AS last_used_at
         FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
        WHERE f.line_account_id = ?`,
    ).bind(context.lineAccountId).first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT COUNT(*) AS created,
              SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS in_use,
              (SELECT MAX(tapped_at) FROM rich_menu_area_taps WHERE line_account_id = ?) AS last_used_at
         FROM rich_menu_groups WHERE account_id = ?`,
    ).bind(context.lineAccountId, context.lineAccountId)
      .first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM tags WHERE line_account_id = ? OR line_account_id IS NULL) +
         (SELECT COUNT(DISTINCT fv.field_id) FROM friend_field_values fv JOIN friends f ON f.id = fv.friend_id
           WHERE f.line_account_id = ?) AS created,
         (SELECT COUNT(DISTINCT ft.tag_id) FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
           WHERE f.line_account_id = ?) +
         (SELECT COUNT(DISTINCT fv.field_id) FROM friend_field_values fv JOIN friends f ON f.id = fv.friend_id
           WHERE f.line_account_id = ?) AS in_use,
         MAX(last_used_at) AS last_used_at FROM (
           SELECT MAX(ft.assigned_at) AS last_used_at FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
            WHERE f.line_account_id = ?
           UNION ALL SELECT MAX(fv.updated_at) FROM friend_field_values fv JOIN friends f ON f.id = fv.friend_id
            WHERE f.line_account_id = ?
         )`,
    ).bind(...Array(6).fill(context.lineAccountId))
      .first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM tracked_links WHERE line_account_id = ?) +
         (SELECT COUNT(*) FROM conversion_points WHERE line_account_id = ?) AS created,
         (SELECT COUNT(*) FROM tracked_links WHERE line_account_id = ? AND is_active = 1) +
         (SELECT COUNT(DISTINCT ce.conversion_point_id) FROM conversion_events ce JOIN friends f ON f.id = ce.friend_id
           WHERE f.line_account_id = ?) AS in_use,
         MAX(last_used_at) AS last_used_at FROM (
           SELECT MAX(c.clicked_at) AS last_used_at FROM link_clicks c JOIN tracked_links l ON l.id = c.tracked_link_id
            WHERE l.line_account_id = ?
           UNION ALL SELECT MAX(ce.created_at) FROM conversion_events ce JOIN friends f ON f.id = ce.friend_id
            WHERE f.line_account_id = ?
         )`,
    ).bind(...Array(6).fill(context.lineAccountId))
      .first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM automation_definitions WHERE line_account_id = ?) +
         (SELECT COUNT(*) FROM common_actions WHERE line_account_id = ?) AS created,
         (SELECT COUNT(*) FROM automation_definitions WHERE line_account_id = ? AND status = 'active') +
         (SELECT COUNT(*) FROM common_actions WHERE line_account_id = ? AND status = 'published') AS in_use,
         MAX(last_used_at) AS last_used_at FROM (
           SELECT MAX(completed_at) AS last_used_at FROM automation_runs WHERE line_account_id = ?
           UNION ALL SELECT MAX(updated_at) FROM common_action_bindings WHERE line_account_id = ?
         )`,
    ).bind(...Array(6).fill(context.lineAccountId))
      .first<{ created: number; in_use: number; last_used_at: string | null }>(),
    Promise.resolve({ created: null, in_use: null, last_used_at: null }),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM automation_runs
           WHERE line_account_id = ? AND is_test = 0
             AND status IN ('success', 'partial', 'failed')
             AND datetime(COALESCE(started_at, created_at)) >= datetime(?)
             AND datetime(COALESCE(started_at, created_at)) < datetime(?)) AS automatic_runs,
         (SELECT COUNT(*) FROM messages_log
           WHERE line_account_id = ? AND direction = 'outgoing'
             AND source = 'manual'
             AND COALESCE(delivery_type, 'push') <> 'test'
             AND datetime(created_at) >= datetime(?)
             AND datetime(created_at) < datetime(?)) AS manual_sends`,
    ).bind(
      context.lineAccountId,
      context.from,
      context.toExclusive,
      context.lineAccountId,
      context.from,
      context.toExclusive,
    ).first<{ automatic_runs: number; manual_sends: number }>(),
  ]);
  const categories = [
    usageCategory({ key: 'templates', label: 'テンプレート', href: '/templates', created: Number(templates?.created ?? 0), inUse: Number(templates?.in_use ?? 0), lastUsedAt: templates?.last_used_at ?? null }),
    usageCategory({ key: 'scenarios', label: 'シナリオ', href: '/scenarios', created: Number(scenarios?.created ?? 0), inUse: Number(scenarios?.in_use ?? 0), lastUsedAt: scenarios?.last_used_at ?? null }),
    usageCategory({ key: 'forms', label: '回答フォーム', href: '/form-submissions', created: Number(forms?.created ?? 0), inUse: Number(forms?.in_use ?? 0), lastUsedAt: forms?.last_used_at ?? null, state: 'partial', reason: '回答実績から所属を確認できるフォームのみです' }),
    usageCategory({ key: 'rich_menus', label: 'リッチメニュー', href: '/rich-menus', created: Number(richMenus?.created ?? 0), inUse: Number(richMenus?.in_use ?? 0), lastUsedAt: richMenus?.last_used_at ?? null }),
    usageCategory({ key: 'friend_attributes', label: 'タグ・友だち情報', href: '/tags', created: Number(tagsFields?.created ?? 0), inUse: Number(tagsFields?.in_use ?? 0), lastUsedAt: tagsFields?.last_used_at ?? null, state: 'partial', reason: '旧共通項目はLINEアカウント所属を持たないため、利用実績から判定しています' }),
    usageCategory({ key: 'inflow_conversion', label: '流入リンク・成果地点', href: '/inflow-links', created: Number(inflow?.created ?? 0), inUse: Number(inflow?.in_use ?? 0), lastUsedAt: inflow?.last_used_at ?? null }),
    usageCategory({ key: 'automations', label: 'オートメーション・共通アクション', href: '/automations', created: Number(automations?.created ?? 0), inUse: Number(automations?.in_use ?? 0), lastUsedAt: automations?.last_used_at ?? null }),
    usageCategory({ key: 'media_vars', label: '登録メディア・共通情報', href: '/contents', created: mediaVars.created, inUse: mediaVars.in_use, lastUsedAt: mediaVars.last_used_at, state: 'unavailable', reason: '旧データにLINEアカウント所属がないため、安全に分けられません' }),
  ];
  const knownUnused = categories.filter((item) => item.unused.value !== null);
  const unusedItems = knownUnused.reduce((sum, item) => sum + (item.unused.value ?? 0), 0);
  const unusedIncomplete = knownUnused.length !== categories.length
    || knownUnused.some((item) => item.unused.state !== 'available');
  const automaticRuns = Number(activity?.automatic_runs ?? 0);
  const manualSends = Number(activity?.manual_sends ?? 0);
  const automaticReason = '現在はオートメーションの実行記録だけを数えています';
  return envelope(context, {
    state: categories.some((item) => item.created.state !== 'available') ? 'partial' : 'available',
    stateReason: '旧データの所属が分からない項目は合計へ混ぜていません',
    checkedAt: context.dataCutoffAt,
    summary: {
      unusedItems: metric(
        unusedItems,
        unusedIncomplete ? 'partial' : 'available',
        unusedIncomplete ? '取得できた分類だけの合計です' : null,
      ),
      automaticRuns: metric(automaticRuns, 'partial', automaticReason),
      manualSends: metric(manualSends),
      estimatedHoursSaved: metric(
        Math.round((automaticRuns * 30 / 3600) * 100) / 100,
        'partial',
        `${automaticReason}。1回30秒として試算しています`,
      ),
    },
    categories,
    automaticDeletion: false,
  });
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
