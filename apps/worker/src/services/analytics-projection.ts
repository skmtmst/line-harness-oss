import {
  rebuildAnalyticsDailyMetricsChunk,
  recentAnalyticsProjectionRange,
  ensureAnalyticsEventCoverage,
  ensureAnalyticsUrlExposureCoverage,
  getAnalyticsProjectionSchedulerCursor,
  saveAnalyticsProjectionSchedulerCursor,
  type LineAccount,
} from '@line-crm/db';

export interface AnalyticsProjectionRefreshResult {
  processed: number;
  matched: number;
  mismatched: number;
  inProgress: number;
  failed: number;
}

export function selectNextAnalyticsProjectionAccount(
  accounts: LineAccount[],
  lastAccountId: string,
): LineAccount | null {
  const active = accounts
    .filter((account) => account.is_active === 1)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return active.find((account) => account.id > lastAccountId) ?? active[0] ?? null;
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
    inProgress: 0,
    failed: 0,
  };
  const cutoffAt = now.toISOString();
  const schedulerCursor = await getAnalyticsProjectionSchedulerCursor(db, cutoffAt);
  const account = selectNextAnalyticsProjectionAccount(accounts, schedulerCursor);
  if (!account) return result;
  result.processed = 1;
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
    const projection = await rebuildAnalyticsDailyMetricsChunk(db, {
      accountId: account.id,
      timeZone: account.timezone || 'Asia/Tokyo',
      range: recentAnalyticsProjectionRange(now, account.timezone || 'Asia/Tokyo', 31),
      dataCutoffAt: cutoffAt,
    });
    if (!projection.completed) result.inProgress = 1;
    else if (projection.status === 'matched') result.matched = 1;
    else result.mismatched = 1;
  } catch (error) {
    result.failed = 1;
    console.error(JSON.stringify({
      event: 'analytics_projection_failed',
      line_account_id: account.id,
      reason: error instanceof Error ? error.message : 'unknown',
    }));
  } finally {
    // 成否に関係なく次のアカウントへ進め、大きい・壊れた1社が他社を塞がないようにする。
    await saveAnalyticsProjectionSchedulerCursor(db, account.id, cutoffAt);
  }
  return result;
}
