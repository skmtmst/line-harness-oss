import { getAdCostTotalsByRoute } from './ad-costs.js';
import { analyticsWindow, analyticsWindowWhere } from './utils.js';
import { type AnalyticsOverviewContext, type AnalyticsMetricState, type AnalyticsRouteOverviewItem } from './analytics-overviews-types.js';
import { getCoverage } from './analytics-overviews-friends.js';
import { metric, envelope } from './analytics-overviews-metrics.js';


export async function getAnalyticsRoutesOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
) {
  const win = analyticsWindow(context.from, context.toExclusive);
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
          ${analyticsWindowWhere('occurred_at')}
        GROUP BY entry_route_id
     ), adds AS (
       SELECT entry_route_id AS route_id, COUNT(*) AS count
         FROM friend_add_events
        WHERE line_account_id = ? AND entry_route_id IS NOT NULL
          ${analyticsWindowWhere('occurred_at')}
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
          ${analyticsWindowWhere('a.occurred_at')}
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
          ${analyticsWindowWhere('ce.created_at')}
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
    context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso,
    context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso,
    context.lineAccountId,
    context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso,
    context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso,
  ).all<{
    id: string; ref_code: string; name: string; clicks: number; friend_adds: number;
    connected: number; reactions: number; approved: number; pending: number;
    rejected: number; revenue: number;
  }>();
  const [missing, attribution, costTotals] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS adds FROM friend_add_events
        WHERE line_account_id = ? AND attribution_status = 'unavailable'
          ${analyticsWindowWhere('occurred_at')}`,
    ).bind(context.lineAccountId, win.lo, win.hi, win.fromIso, win.toIso).first<{ adds: number }>(),
    getCoverage(db, context.lineAccountId, 'friend_add', context.from),
    getAdCostTotalsByRoute(db, {
      lineAccountId: context.lineAccountId,
      from: context.fromDate,
      to: context.toDate,
    }),
  ]);
  // 広告費は最小通貨単位で来る。表示は円だけ扱うので、JPY以外や
  // 複数通貨が混ざる経路は換算根拠がない旨を理由にして出さない。
  const costMetric = (routeId: string) => {
    const totals = costTotals.get(routeId);
    if (!totals || totals.length === 0) {
      return metric<number>(null, 'unavailable', 'この経路の広告費は取り込まれていません');
    }
    if (totals.length > 1 || totals[0].currency !== 'JPY') {
      return metric<number>(null, 'unavailable', '通貨が複数あるか円以外のため、換算なしでは合計できません');
    }
    return metric<number>(totals[0].amountMinor, 'available', null);
  };
  const costPerFriendMetric = (routeId: string, friendAdds: number, state: AnalyticsMetricState, reason: string | null) => {
    const cost = costMetric(routeId);
    if (cost.value === null) return metric<number>(null, cost.state, cost.reason);
    if (state !== 'available') return metric<number>(null, state, reason);
    if (friendAdds === 0) return metric<number>(null, 'unavailable', 'この期間の友だち追加が0件のため割れません');
    return metric<number>(Math.round((cost.value / friendAdds) * 100) / 100, 'available', null);
  };
  const routes: AnalyticsRouteOverviewItem[] = rows.results.map((row) => {
    const adCost = costMetric(row.id);
    const costPerFriend = costPerFriendMetric(row.id, Number(row.friend_adds), attribution.state, attribution.reason);
    const approved = Number(row.approved);
    const revenue = Number(row.revenue);
    return {
      id: row.id,
      refCode: row.ref_code,
      name: row.name,
      clicks: metric(Number(row.clicks), 'partial', 'ログイン・LIFF・短縮リンクで識別できた接触のみです'),
      friendAdds: metric(Number(row.friend_adds), attribution.state, attribution.reason),
      currentFriends: metric(Number(row.connected), attribution.state, attribution.reason),
      reactionPeople: metric(Number(row.reactions), 'partial', '記録開始後の受信・ボタン・URL反応です'),
      conversions: {
        approved: metric(approved),
        pending: metric(Number(row.pending)),
        rejected: metric(Number(row.rejected)),
        revenue: metric(revenue),
      },
      adCost,
      costPerFriend,
      costPerConversion: adCost.value === null
        ? metric<number>(null, adCost.state, adCost.reason)
        : approved === 0
          ? metric<number>(null, 'unavailable', 'この期間の成果が0件のため割れません')
          : metric<number>(Math.round((adCost.value / approved) * 100) / 100, 'available', null),
      profitAfterAdCost: adCost.value === null
        ? metric<number>(null, adCost.state, adCost.reason)
        : metric<number>(revenue - adCost.value, 'available', null),
    };
  });
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
      adCost: metric<number>(null, 'unavailable', '経路が分からない分には広告費を帰属できません'),
      costPerFriend: metric<number>(null, 'unavailable', '経路が分からない分には広告費を帰属できません'),
      costPerConversion: metric<number>(null, 'unavailable', '経路が分からない分には広告費を帰属できません'),
      profitAfterAdCost: metric<number>(null, 'unavailable', '経路が分からない分には広告費を帰属できません'),
    });
  }
  return envelope(context, {
    attributionModel: 'first_touch',
    attributionLabel: '第一接触',
    routes,
    searchConsoleHref: '/search-console',
  });
}
