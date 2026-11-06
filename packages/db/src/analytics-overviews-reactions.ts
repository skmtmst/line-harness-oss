import { analyticsWindow, analyticsWindowWhere } from './utils.js';
import { type AnalyticsOverviewContext, type ReactionCampaign, type AnalyticsMetricState } from './analytics-overviews-types.js';
import { getCoverage, hourInTimeZone } from './analytics-overviews-friends.js';
import { metric, envelope } from './analytics-overviews-metrics.js';


// 配信反応の一覧は系統ごとに先頭からこの件数まで。1件多く取って打切りを検知し、
// 画面が「全部出ている」のか「先頭だけ出ている」のかを区別できるようにする。
export const REACTION_CAMPAIGN_LIMIT = 200;

export async function getAnalyticsReactionsOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
) {
  const win = analyticsWindow(context.from, context.toExclusive);
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
          ${analyticsWindowWhere('b.sent_at')}
        ORDER BY b.sent_at DESC, b.id DESC LIMIT ${REACTION_CAMPAIGN_LIMIT + 1}`,
    ).bind(context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso).all<{
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
          ${analyticsWindowWhere('m.created_at')}
        GROUP BY s.id, s.name ORDER BY sent_at DESC LIMIT ${REACTION_CAMPAIGN_LIMIT + 1}`,
    ).bind(context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso).all<{
      id: string; name: string; sent_at: string; sent_count: number; target_count: number;
    }>(),
    db.prepare(
      `SELECT c.clicked_at
         FROM link_clicks c JOIN tracked_links l ON l.id = c.tracked_link_id
        WHERE l.line_account_id = ?
          ${analyticsWindowWhere('c.clicked_at')}
        ORDER BY c.clicked_at LIMIT 50001`,
    ).bind(context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso).all<{ clicked_at: string }>(),
    getCoverage(db, context.lineAccountId, 'conversion_approved', context.from),
  ]);

  const broadcastTruncated = broadcastRows.results.length > REACTION_CAMPAIGN_LIMIT;
  const scenarioTruncated = scenarioRows.results.length > REACTION_CAMPAIGN_LIMIT;
  const campaigns: ReactionCampaign[] = broadcastRows.results
    .slice(0, REACTION_CAMPAIGN_LIMIT)
    .map((row) => {
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
      sentMessages: metric<number>(null, 'unavailable', '一斉配信は人数で集計します'),
      opened: metric(row.unique_impression == null ? null : Number(row.unique_impression), insightState, reason),
      lineClicked: metric(row.unique_click == null ? null : Number(row.unique_click), insightState, reason),
      outcomes: metric<number>(null, outcomeCoverage.state, outcomeCoverage.reason),
      fetchedAt: row.fetched_at,
    };
  });
  campaigns.push(...scenarioRows.results.slice(0, REACTION_CAMPAIGN_LIMIT).map((row) => ({
    id: row.id,
    name: row.name,
    kind: 'scenario' as const,
    sentAt: row.sent_at,
    targetPeople: metric(Number(row.target_count ?? 0)),
    // 送信ログは「送った」記録であって相手の端末への到達ではない。
    // 通数は sentMessages に出し、届いた人数は取れないと正直に返す。
    delivered: metric<number>(null, 'unavailable', 'シナリオは送信ログだけなので、届いた人数は分かりません'),
    sentMessages: metric(Number(row.sent_count ?? 0)),
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
    // 上限に達した系統だけ true。画面はこれを見て「先頭○件まで表示」の注記を出す。
    campaignsTruncation: {
      limit: REACTION_CAMPAIGN_LIMIT,
      broadcast: broadcastTruncated,
      scenario: scenarioTruncated,
    },
    trackedClickHours: clickHours,
    clickDefinition: '自社計測URLが実際にクリックされた時間',
  });
}
