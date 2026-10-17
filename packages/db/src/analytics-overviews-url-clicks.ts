import { getTrackedLinkStats } from './analytics.js';
import { analyticsWindow, analyticsWindowWhere } from './utils.js';
import { type AnalyticsOverviewContext, type AnalyticsMetricState } from './analytics-overviews-types.js';
import { metric, envelope } from './analytics-overviews-metrics.js';


export async function getAnalyticsUrlClicksOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
  limit = 200,
  query?: string,
) {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const inclusiveTo = new Date(new Date(context.toExclusive).getTime() - 1).toISOString();
  const win = analyticsWindow(context.from, context.toExclusive);
  const [allStats, coverage] = await Promise.all([
    getTrackedLinkStats(
      db,
      context.lineAccountId,
      { from: context.from, to: inclusiveTo },
      safeLimit + 1,
      query,
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
                   ${analyticsWindowWhere('c.clicked_at')}
              ) THEN e.friend_id END) AS clicked_people,
              SUM(CASE WHEN e.audience_state = 'unknown' THEN 1 ELSE 0 END) AS unknown_audiences,
              MIN(e.sent_at) AS first_sent_at,
              MAX(e.sent_at) AS last_sent_at,
              GROUP_CONCAT(DISTINCT e.source_kind) AS source_kinds
         FROM analytics_url_exposures e
        WHERE e.line_account_id = ?
          ${analyticsWindowWhere('e.sent_at')}
          AND e.tracked_link_id IN (${placeholders})
        GROUP BY e.tracked_link_id`,
        )
        .bind(
          win.lo,
          win.hi,
          context.from,
          context.toExclusive,
          context.lineAccountId,
          win.lo,
          win.hi,
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
