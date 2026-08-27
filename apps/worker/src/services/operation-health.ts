import {
  claimOperationHealthRun,
  completeOperationHealthRun,
  failOperationHealthRun,
  getLatestOperationHealthSnapshot,
  getLineAccounts,
  type OperationHealthResult,
  type OperationHealthSeverity,
  type OperationHealthSnapshot,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { fetchLineQuota } from './line-quota.js';

const FIVE_MINUTES = 5 * 60_000;

function result(
  checkKey: OperationHealthResult['checkKey'],
  severity: OperationHealthSeverity,
  detail: string,
  metrics: Record<string, unknown>,
  checkedAt: string,
): OperationHealthResult {
  return { checkKey, severity, detail, metrics, checkedAt };
}

function errorResult(
  checkKey: OperationHealthResult['checkKey'],
  checkedAt: string,
): OperationHealthResult {
  const labels = {
    quota: '月間配信数', api: 'API・外部連携', webhook: 'Webhook',
    delivery: '配信処理', friends: '友だちの日次変化',
  } as const;
  return result(checkKey, 'unknown', `${labels[checkKey]}を確認できませんでした`, {}, checkedAt);
}

async function checkQuota(db: D1Database, checkedAt: string): Promise<OperationHealthResult> {
  const accounts = (await getLineAccounts(db)).filter((account) => account.is_active);
  if (accounts.length === 0) {
    return result('quota', 'unknown', '有効なLINEアカウントが登録されていません', { accountCount: 0 }, checkedAt);
  }
  const quotas = await Promise.all(accounts.map((account) => fetchLineQuota(account.channel_access_token)));
  const failed = quotas.filter((quota) => quota.failed).length;
  const limited = quotas.filter((quota) => quota.limit != null && quota.used != null);
  const ratios = limited.map((quota) => (quota.used ?? 0) / Math.max(1, quota.limit ?? 1));
  const maxRatio = ratios.length > 0 ? Math.max(...ratios) : null;
  const severity: OperationHealthSeverity = maxRatio != null && maxRatio >= 0.95
    ? 'danger'
    : maxRatio != null && maxRatio >= 0.8
      ? 'warning'
      : failed > 0
        ? 'unknown'
        : 'normal';
  const detail = failed > 0
    ? `${accounts.length}アカウント中${failed}件の送信枠を取得できませんでした`
    : maxRatio == null
      ? `${accounts.length}アカウントの送信数を確認しました（上限なし）`
      : `最も使用率が高いアカウントは${Math.floor(maxRatio * 100)}%です`;
  return result('quota', severity, detail, {
    accountCount: accounts.length,
    failedCount: failed,
    maxUsagePercent: maxRatio == null ? null : Math.floor(maxRatio * 100),
  }, checkedAt);
}

async function checkApi(db: D1Database, checkedAt: string): Promise<OperationHealthResult> {
  await db.prepare('SELECT 1 AS ok').first();
  const warningCutoff = new Date(Date.parse(checkedAt) - 60 * 60_000).toISOString();
  const stuckCutoff = new Date(Date.parse(checkedAt) - 10 * 60_000).toISOString();
  const [failed, stuck] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM ec_events WHERE status = 'failed' AND updated_at >= ?`)
      .bind(warningCutoff).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM ec_events WHERE status = 'processing' AND updated_at < ?`)
      .bind(stuckCutoff).first<{ count: number }>(),
  ]);
  const failedCount = Number(failed?.count ?? 0);
  const stuckCount = Number(stuck?.count ?? 0);
  const severity: OperationHealthSeverity = stuckCount > 0 ? 'danger' : failedCount > 0 ? 'warning' : 'normal';
  const detail = stuckCount > 0
    ? `10分以上処理中のEC連携が${stuckCount}件あります`
    : failedCount > 0
      ? `1時間以内に失敗したEC連携が${failedCount}件あります`
      : '管理APIとEC連携の処理状態を確認しました';
  return result('api', severity, detail, { failedLastHour: failedCount, stuckCount }, checkedAt);
}

async function checkWebhooks(db: D1Database, checkedAt: string): Promise<OperationHealthResult> {
  const [incoming, outgoing] = await Promise.all([
    db.prepare(`SELECT
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN is_active = 1 AND (secret IS NULL OR trim(secret) = '') THEN 1 ELSE 0 END) AS missing_secret
      FROM incoming_webhooks`).first<{ active_count: number | null; missing_secret: number | null }>(),
    db.prepare(`SELECT
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN is_active = 1 AND (secret IS NULL OR trim(secret) = '') THEN 1 ELSE 0 END) AS missing_secret,
        SUM(CASE WHEN is_active = 1 AND consecutive_failures > 0 THEN 1 ELSE 0 END) AS failed,
        MAX(CASE WHEN is_active = 1 THEN consecutive_failures ELSE 0 END) AS max_failures
      FROM outgoing_webhooks`).first<{
        active_count: number | null; missing_secret: number | null; failed: number | null; max_failures: number | null;
      }>(),
  ]);
  const incomingCount = Number(incoming?.active_count ?? 0);
  const outgoingCount = Number(outgoing?.active_count ?? 0);
  const missingSecret = Number(incoming?.missing_secret ?? 0) + Number(outgoing?.missing_secret ?? 0);
  const failedCount = Number(outgoing?.failed ?? 0);
  const maxFailures = Number(outgoing?.max_failures ?? 0);
  const severity: OperationHealthSeverity = missingSecret > 0 || maxFailures >= 3
    ? 'danger'
    : failedCount > 0
      ? 'warning'
      : 'normal';
  const detail = missingSecret > 0
    ? `有効なWebhookの署名設定不足が${missingSecret}件あります`
    : failedCount > 0
      ? `送信に連続失敗しているWebhookが${failedCount}件あります`
      : `受信${incomingCount}件・送信${outgoingCount}件の設定と失敗状態を確認しました`;
  return result('webhook', severity, detail, {
    incomingCount, outgoingCount, missingSecret, failedCount, maxFailures,
  }, checkedAt);
}

async function checkDelivery(db: D1Database, checkedAt: string): Promise<OperationHealthResult> {
  const warningCutoff = new Date(Date.parse(checkedAt) - 10 * 60_000).toISOString();
  const dangerCutoff = new Date(Date.parse(checkedAt) - 30 * 60_000).toISOString();
  const [warning, danger, automationWarning, automationDanger] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM broadcasts
      WHERE (status = 'scheduled' AND scheduled_at < ?)
         OR (status = 'sending' AND COALESCE(batch_lock_at, scheduled_at, created_at) < ?)`)
      .bind(warningCutoff, warningCutoff).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM broadcasts
      WHERE (status = 'scheduled' AND scheduled_at < ?)
         OR (status = 'sending' AND COALESCE(batch_lock_at, scheduled_at, created_at) < ?)`)
      .bind(dangerCutoff, dangerCutoff).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM automation_runs
      WHERE (status = 'queued' AND created_at < ?)
         OR (status = 'waiting' AND resume_at < ?)
         OR (status = 'running' AND lease_expires_at < ?)`)
      .bind(warningCutoff, warningCutoff, warningCutoff).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM automation_runs
      WHERE (status = 'queued' AND created_at < ?)
         OR (status = 'waiting' AND resume_at < ?)
         OR (status = 'running' AND lease_expires_at < ?)`)
      .bind(dangerCutoff, dangerCutoff, dangerCutoff).first<{ count: number }>(),
  ]);
  const warningCount = Number(warning?.count ?? 0) + Number(automationWarning?.count ?? 0);
  const dangerCount = Number(danger?.count ?? 0) + Number(automationDanger?.count ?? 0);
  const severity: OperationHealthSeverity = dangerCount > 0 ? 'danger' : warningCount > 0 ? 'warning' : 'normal';
  const detail = dangerCount > 0
    ? `30分以上進んでいない配信・自動処理が${dangerCount}件あります`
    : warningCount > 0
      ? `10分以上進んでいない配信・自動処理が${warningCount}件あります`
      : '予約配信・送信中配信・自動処理の滞留を確認しました';
  return result('delivery', severity, detail, { warningCount, dangerCount }, checkedAt);
}

async function checkFriends(db: D1Database, checkedAt: string): Promise<OperationHealthResult> {
  const rows = await db.prepare(`SELECT date, active, total, added, blocked
    FROM friend_daily_snapshots WHERE line_account_id = '' ORDER BY date DESC LIMIT 2`)
    .all<{ date: string; active: number; total: number; added: number; blocked: number }>();
  const latest = rows.results[0];
  if (!latest) return result('friends', 'unknown', '友だち数の日次記録がまだありません', {}, checkedAt);
  const checkedDate = new Date(checkedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const ageDays = Math.floor((Date.parse(`${checkedDate}T00:00:00+09:00`) - Date.parse(`${latest.date}T00:00:00+09:00`)) / 86_400_000);
  if (ageDays > 1) {
    return result('friends', 'unknown', `友だち数の日次記録が${ageDays}日更新されていません`, { latestDate: latest.date }, checkedAt);
  }
  const previous = rows.results[1];
  const activeDrop = previous ? Math.max(0, previous.active - latest.active) : 0;
  const activeDropRatio = previous && previous.active > 0 ? activeDrop / previous.active : 0;
  const blockedRatio = latest.total > 0 ? latest.blocked / latest.total : 0;
  const severity: OperationHealthSeverity = (activeDrop >= 25 && activeDropRatio >= 0.1) || blockedRatio >= 0.1
    ? 'danger'
    : (activeDrop >= 10 && activeDropRatio >= 0.05) || blockedRatio >= 0.05
      ? 'warning'
      : 'normal';
  const detail = severity === 'danger' || severity === 'warning'
    ? `直近日の追加${latest.added}人・ブロック${latest.blocked}人・有効友だち減少${activeDrop}人です`
    : `直近日の追加${latest.added}人・ブロック${latest.blocked}人を確認しました`;
  return result('friends', severity, detail, {
    latestDate: latest.date, added: latest.added, blocked: latest.blocked, activeDrop,
  }, checkedAt);
}

export async function runOperationHealthChecks(
  env: Env['Bindings'],
  now = new Date(),
  options: { force?: boolean } = {},
): Promise<OperationHealthSnapshot | null> {
  const checkedAt = now.toISOString();
  const bucketKey = options.force
    ? `manual:${crypto.randomUUID()}`
    : String(Math.floor(now.getTime() / FIVE_MINUTES));
  const runId = await claimOperationHealthRun(env.DB, { bucketKey, startedAt: checkedAt });
  if (!runId) return getLatestOperationHealthSnapshot(env.DB);
  try {
    const settled = await Promise.allSettled([
      checkQuota(env.DB, checkedAt),
      checkApi(env.DB, checkedAt),
      checkWebhooks(env.DB, checkedAt),
      checkDelivery(env.DB, checkedAt),
      checkFriends(env.DB, checkedAt),
    ]);
    const keys: OperationHealthResult['checkKey'][] = ['quota', 'api', 'webhook', 'delivery', 'friends'];
    const results = settled.map((item, index) => item.status === 'fulfilled'
      ? item.value
      : errorResult(keys[index]!, checkedAt));
    await completeOperationHealthRun(env.DB, { runId, completedAt: new Date().toISOString(), results });
    return getLatestOperationHealthSnapshot(env.DB);
  } catch (error) {
    await failOperationHealthRun(env.DB, {
      runId,
      completedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }
}
