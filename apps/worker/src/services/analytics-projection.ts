import { logger } from '@line-crm/shared/server';
import {
  rebuildAnalyticsDailyMetricsChunk,
  recentAnalyticsProjectionRange,
  ensureAnalyticsEventCoverage,
  ensureAnalyticsUrlExposureCoverage,
  getAnalyticsProjectionSchedulerCursor,
  saveAnalyticsProjectionSchedulerCursor,
  type LineAccount,
} from '@line-crm/db';

import { featureJobCanRun } from './feature-enforcement.js';

export type AnalyticsProjectionAccount = Pick<LineAccount, 'id' | 'is_active' | 'timezone'>;

export interface AnalyticsProjectionRefreshResult {
  processed: number;
  matched: number;
  mismatched: number;
  inProgress: number;
  failed: number;
}

export function selectNextAnalyticsProjectionAccount(
  accounts: AnalyticsProjectionAccount[],
  lastAccountId: string,
): AnalyticsProjectionAccount | null {
  const active = accounts
    .filter((account) => account.is_active === 1)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return active.find((account) => account.id > lastAccountId) ?? active[0] ?? null;
}

export async function refreshRecentAnalyticsProjections(
  db: D1Database,
  accounts: AnalyticsProjectionAccount[],
  now: Date,
): Promise<AnalyticsProjectionRefreshResult> {
  const schedulerCursor = await getAnalyticsProjectionSchedulerCursor(db, now.toISOString());
  const account = selectNextAnalyticsProjectionAccount(accounts, schedulerCursor);
  if (!account) return { processed: 0, matched: 0, mismatched: 0, inProgress: 0, failed: 0 };
  try {
    return await refreshAccountAnalyticsProjection(db, account, now);
  } finally {
    await saveAnalyticsProjectionSchedulerCursor(db, account.id, now.toISOString());
  }
}

/** One bounded account chunk; queue consumers serialize calls with an account lease. */
export async function refreshAccountAnalyticsProjection(
  db: D1Database,
  account: AnalyticsProjectionAccount,
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
  try {
    // OFFでは集計・カバレッジを書き込まず、呼び出し元が次のアカウントへ進む。
    if (!await featureJobCanRun(db, { accountId: account.id, featureId: 'analytics', job: 'analytics projection' })) {
      return result;
    }
    result.processed = 1;
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
    logger.error("analytics_projection_failed");
  }
  return result;
}
