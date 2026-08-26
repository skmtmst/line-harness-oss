import {
  rebuildAnalyticsDailyMetrics,
  recentAnalyticsProjectionRange,
  ensureAnalyticsEventCoverage,
  ensureAnalyticsUrlExposureCoverage,
  type LineAccount,
} from '@line-crm/db';

export interface AnalyticsProjectionRefreshResult {
  processed: number;
  matched: number;
  mismatched: number;
  failed: number;
}

export async function refreshRecentAnalyticsProjections(
  db: D1Database,
  accounts: LineAccount[],
  now: Date,
): Promise<AnalyticsProjectionRefreshResult> {
  const result: AnalyticsProjectionRefreshResult = {
    processed: 0,
    matched: 0,
    mismatched: 0,
    failed: 0,
  };
  const cutoffAt = now.toISOString();
  for (const account of accounts) {
    if (account.is_active !== 1) continue;
    result.processed += 1;
    try {
      // 現在のWorkerが受付開始から欠けなく記録できる種類だけを「取得可能」にする。
      // 未接続のフォーム・購入などを0件として見せないため、全種類は登録しない。
      await ensureAnalyticsEventCoverage(db, {
        lineAccountId: account.id,
        eventTypes: [
          'friend_add', 'friend_unfollow', 'message_received', 'postback_received',
        ],
        availableFrom: now.toISOString(),
      });
      await ensureAnalyticsUrlExposureCoverage(db, {
        lineAccountId: account.id,
        availableFrom: now.toISOString(),
        updatedAt: cutoffAt,
      });
      const projection = await rebuildAnalyticsDailyMetrics(db, {
        accountId: account.id,
        timeZone: account.timezone || 'Asia/Tokyo',
        range: recentAnalyticsProjectionRange(now, account.timezone || 'Asia/Tokyo', 31),
        dataCutoffAt: cutoffAt,
      });
      if (projection.status === 'matched') result.matched += 1;
      else result.mismatched += 1;
    } catch (error) {
      result.failed += 1;
      console.error(JSON.stringify({
        event: 'analytics_projection_failed',
        line_account_id: account.id,
        reason: error instanceof Error ? error.message : 'unknown',
      }));
    }
  }
  return result;
}
