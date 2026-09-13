import {
  completeOperationHealthRun,
  failOperationHealthRun,
  startOperationHealthRun,
  type OperationHealthResultInput,
  type OperationHealthStatus,
} from '@line-crm/db';

import { fetchQuota } from './broadcast-quota-guard.js';

type AccountRow = { id: string; channel_access_token: string; is_active: number };

function result(
  checkKey: OperationHealthResultInput['checkKey'],
  status: OperationHealthStatus,
  summary: string,
  source: string,
  observedAt: string,
  value: Record<string, unknown> | null = null,
  threshold: Record<string, unknown> | null = null,
): OperationHealthResultInput {
  return { checkKey, status, summary, source, observedAt, value, threshold };
}

async function isolate(
  checkKey: OperationHealthResultInput['checkKey'],
  observedAt: string,
  run: () => Promise<OperationHealthResultInput>,
): Promise<OperationHealthResultInput> {
  try {
    return await run();
  } catch {
    return result(checkKey, 'unknown', '確認に失敗しました', 'server_check', observedAt);
  }
}

async function collectChecks(
  db: D1Database,
  account: AccountRow,
  observedAt: string,
): Promise<OperationHealthResultInput[]> {
  return Promise.all([
    isolate('line_connection', observedAt, async () => {
      const row = await db.prepare(
        `SELECT risk_level, error_code, error_count, created_at
           FROM account_health_logs WHERE line_account_id = ?
          ORDER BY created_at DESC LIMIT 1`,
      ).bind(account.id).first<{
        risk_level: 'normal' | 'warning' | 'danger'; error_code: number | null;
        error_count: number; created_at: string;
      }>();
      if (!row) return result('line_connection', 'unknown', 'LINE接続の確認記録がありません', 'account_health_logs', observedAt);
      return result('line_connection', row.risk_level,
        row.risk_level === 'normal' ? 'LINE接続は正常です' : 'LINE接続に問題があります',
        'account_health_logs', row.created_at,
        { errorCode: row.error_code, consecutiveErrors: row.error_count });
    }),
    isolate('message_quota', observedAt, async () => {
      const quota = await fetchQuota(account.channel_access_token);
      if (quota.limit === null || quota.used === null) {
        return result('message_quota', 'unknown', 'LINEの配信上限を取得できませんでした', 'line_messaging_api', observedAt);
      }
      const ratio = quota.limit === 0 ? 1 : quota.used / quota.limit;
      const status: OperationHealthStatus = ratio >= 0.95 ? 'danger' : ratio >= 0.8 ? 'warning' : 'normal';
      return result('message_quota', status,
        status === 'normal' ? '今月の配信枠に余裕があります' : '今月の配信枠が少なくなっています',
        'line_messaging_api', observedAt,
        { used: quota.used, limit: quota.limit, remaining: Math.max(0, quota.limit - quota.used) },
        { warningRatio: 0.8, dangerRatio: 0.95 });
    }),
    isolate('external_integrations', observedAt, async () => {
      const row = await db.prepare(
        `SELECT COUNT(*) AS active_count,
                COALESCE(SUM(CASE WHEN consecutive_failures > 0 THEN 1 ELSE 0 END), 0) AS failing_count,
                COALESCE(MAX(consecutive_failures), 0) AS max_failures
           FROM outgoing_webhooks WHERE line_account_id = ? AND is_active = 1`,
      ).bind(account.id).first<{ active_count: number; failing_count: number; max_failures: number }>();
      const failing = Number(row?.failing_count ?? 0);
      const maxFailures = Number(row?.max_failures ?? 0);
      const status: OperationHealthStatus = maxFailures >= 3 ? 'danger' : failing > 0 ? 'warning' : 'normal';
      return result('external_integrations', status,
        status === 'normal' ? '外部連携に連続失敗はありません' : '外部連携に連続失敗があります',
        'outgoing_webhooks', observedAt,
        { activeCount: Number(row?.active_count ?? 0), failingCount: failing, maxConsecutiveFailures: maxFailures },
        { warningFailures: 1, dangerFailures: 3 });
    }),
    isolate('webhook', observedAt, async () => {
      const row = await db.prepare(
        `SELECT MAX(received_at) AS last_received_at,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count,
                COUNT(*) AS event_count
           FROM line_webhook_events
          WHERE line_account_id = ? AND received_at >= datetime(?, '-1 hour')`,
      ).bind(account.id, observedAt).first<{
        last_received_at: string | null; failed_count: number; event_count: number;
      }>();
      if (!row?.last_received_at) {
        return result('webhook', 'unknown', '直近1時間のWebhook受信がありません', 'line_webhook_events', observedAt,
          { eventCount: 0, failedCount: 0, lastReceivedAt: null });
      }
      const failed = Number(row.failed_count);
      const status: OperationHealthStatus = failed >= 3 ? 'danger' : failed > 0 ? 'warning' : 'normal';
      return result('webhook', status,
        status === 'normal' ? 'Webhook受信は正常です' : 'Webhook受信に失敗があります',
        'line_webhook_events', observedAt,
        { eventCount: Number(row.event_count), failedCount: failed, lastReceivedAt: row.last_received_at },
        { warningFailures: 1, dangerFailures: 3 });
    }),
    isolate('dispatch_jobs', observedAt, async () => {
      const row = await db.prepare(
        `SELECT COUNT(*) AS pending_count, MIN(created_at) AS oldest_at
           FROM automation_runs
          WHERE line_account_id = ? AND status IN ('queued', 'running', 'waiting')`,
      ).bind(account.id).first<{ pending_count: number; oldest_at: string | null }>();
      const oldestMs = row?.oldest_at ? Date.parse(row.oldest_at) : Number.NaN;
      const delayMinutes = Number.isFinite(oldestMs)
        ? Math.max(0, Math.floor((Date.parse(observedAt) - oldestMs) / 60_000))
        : 0;
      const status: OperationHealthStatus = delayMinutes >= 30 ? 'danger' : delayMinutes >= 10 ? 'warning' : 'normal';
      return result('dispatch_jobs', status,
        status === 'normal' ? '自動処理の滞留はありません' : '自動処理が滞留しています',
        'automation_runs', observedAt,
        { pendingCount: Number(row?.pending_count ?? 0), oldestAt: row?.oldest_at ?? null, delayMinutes },
        { warningMinutes: 10, dangerMinutes: 30 });
    }),
    isolate('friend_change', observedAt, async () => {
      const rows = await db.prepare(
        `SELECT date, active, added, blocked
           FROM friend_daily_snapshots WHERE line_account_id = ?
          ORDER BY date DESC LIMIT 2`,
      ).bind(account.id).all<{ date: string; active: number; added: number; blocked: number }>();
      const latest = rows.results?.[0];
      const previous = rows.results?.[1];
      if (!latest || !previous) {
        return result('friend_change', 'unknown', '友だち変化の比較記録が足りません', 'friend_daily_snapshots', observedAt);
      }
      const delta = latest.active - previous.active;
      const ratio = previous.active > 0 ? delta / previous.active : 0;
      const status: OperationHealthStatus = ratio <= -0.1 ? 'danger' : ratio <= -0.05 ? 'warning' : 'normal';
      return result('friend_change', status,
        status === 'normal' ? '友だち数に大きな減少はありません' : '友だち数が大きく減少しています',
        'friend_daily_snapshots', observedAt,
        { active: latest.active, added: latest.added, blocked: latest.blocked, delta, changeRatio: ratio },
        { warningDecreaseRatio: -0.05, dangerDecreaseRatio: -0.1 });
    }),
  ]);
}

export async function runOperationHealthChecks(
  db: D1Database,
  input: { lineAccountId: string; source: 'scheduled' | 'manual'; actorId?: string | null; now?: string },
) {
  const started = await startOperationHealthRun(db, input);
  if (!started.created) return { duplicate: true, run: started.run };
  try {
    const account = await db.prepare(
      'SELECT id, channel_access_token, is_active FROM line_accounts WHERE id = ?',
    ).bind(input.lineAccountId).first<AccountRow>();
    if (!account || account.is_active !== 1) throw new Error('line_account_not_active');
    const observedAt = input.now ?? new Date().toISOString();
    const results = await collectChecks(db, account, observedAt);
    return { duplicate: false, run: await completeOperationHealthRun(db, started.run.id, results, observedAt) };
  } catch (error) {
    await failOperationHealthRun(db, started.run.id,
      error instanceof Error ? error.message : 'health_check_failed');
    throw error;
  }
}

export async function runScheduledOperationHealthChecks(db: D1Database): Promise<void> {
  const rows = await db.prepare('SELECT id FROM line_accounts WHERE is_active = 1 ORDER BY id')
    .all<{ id: string }>();
  await Promise.allSettled((rows.results ?? []).map((account) =>
    runOperationHealthChecks(db, { lineAccountId: account.id, source: 'scheduled' })));
}
