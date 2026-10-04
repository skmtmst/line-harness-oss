import {
  completeOperationHealthRun,
  enqueuePendingOperationAlertNotifications,
  failOperationHealthRun,
  reconcileOperationHealthAlerts,
  startOperationHealthRun,
  type OperationHealthResultInput,
  type OperationHealthStatus,
} from '@line-crm/db';

import { fetchQuota } from './broadcast-quota-guard.js';
import { findPlan } from './billing-plans.js';
import { collectOperationDispatchHealth } from './operation-dispatch-health.js';

type AccountRow = {
  id: string;
  channel_access_token: string;
  is_active: number;
  token_expires_at: string | null;
  tenant_id: string | null;
};

/** R2・Queue の束縛は環境次第で無いので、持っているものだけ渡す。 */
export type OperationInfraDeps = {
  r2?: R2Bucket;
  queue?: Queue<unknown>;
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CREDENTIAL_WARNING_DAYS = 14;
const INFRA_SLOW_MS = 3_000;
const INFRA_ALERT_AFTER = 3;
/** 解消も3回連続の成功で確定する。1回の成功で閉じると「解消→再発」が繰り返される。 */
const INFRA_RECOVER_AFTER = 3;
const FRIEND_DECREASE_WARNING_RATIO = -0.05;
const FRIEND_DECREASE_DANGER_RATIO = -0.1;
const FRIEND_DECREASE_MIN_ABSOLUTE = 10;

/** JST の月初・翌月初を、台帳の JST 壁時計（オフセット無し）と同じ形で返す。 */
function jstMonthBounds(nowIso: string): { monthStart: string; monthEnd: string; resetAt: string } {
  const jst = new Date(Date.parse(nowIso) + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m + 1)}-01T00:00:00`;
  const end = m === 11
    ? `${y + 1}-01-01T00:00:00`
    : `${y}-${pad(m + 2)}-01T00:00:00`;
  return { monthStart: start, monthEnd: end, resetAt: `${end}+09:00` };
}

/**
 * 連続失敗の数え上げ。infra_canary は「3回続いたときだけ異常」にするため、
 * 失敗した実行でも status は normal のまま残る。実際の失敗は value_json の
 * `failed` 印を見て数える（印の無い古い行は status で判断する）。
 */
async function recentCheckResults(
  db: D1Database,
  lineAccountId: string,
  checkKey: OperationHealthResultInput['checkKey'],
  limit: number,
): Promise<Array<{ status: OperationHealthStatus; failed: boolean }>> {
  const rows = await db.prepare(
    `SELECT r.status, r.value_json
       FROM operation_health_results r
       JOIN operation_health_runs h ON h.id = r.run_id
      WHERE h.scope_key = ? AND r.check_key = ?
      ORDER BY r.observed_at DESC, r.id DESC
      LIMIT ?`,
  ).bind(lineAccountId, checkKey, limit).all<{ status: string; value_json: string | null }>();
  return (rows.results ?? []).map((row) => {
    let failed = row.status !== 'normal';
    if (row.value_json) {
      try {
        const value = JSON.parse(row.value_json) as { failed?: boolean };
        if (typeof value.failed === 'boolean') failed = value.failed;
      } catch { /* 壊れた行は status 側の判定を使う */ }
    }
    return { status: row.status as OperationHealthStatus, failed };
  });
}

async function countRecentFailures(
  db: D1Database,
  lineAccountId: string,
  checkKey: OperationHealthResultInput['checkKey'],
  limit: number,
): Promise<number> {
  let consecutive = 0;
  for (const row of await recentCheckResults(db, lineAccountId, checkKey, limit)) {
    if (!row.failed) break;
    consecutive += 1;
  }
  return consecutive;
}

/**
 * 知らせている最中かどうか。直前の記録が異常なら、その重さを引き継ぐ。
 * 一度正常に戻った後の古い異常は見ない（戻った時点で知らせは閉じている）。
 */
function holdingSeverity(
  recent: Array<{ status: OperationHealthStatus; failed: boolean }>,
): 'warning' | 'danger' | null {
  const latest = recent[0];
  return latest && (latest.status === 'danger' || latest.status === 'warning')
    ? latest.status
    : null;
}

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
  deps: OperationInfraDeps,
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
      // LINE公式側とHarness契約側の両方を見る。送れる数は小さい方で、
      // 予定済み配信の見込み通数を引いた forecast も返す（v6-32 §5-2）。
      const { monthStart, monthEnd, resetAt } = jstMonthBounds(observedAt);
      const [quota, harnessUsedRow, tenantRow, scheduledRow] = await Promise.all([
        fetchQuota(account.channel_access_token),
        db.prepare(
          `SELECT COUNT(*) AS used FROM messages_log
            WHERE line_account_id = ? AND direction = 'outgoing'
              AND created_at >= ? AND created_at < ?`,
        ).bind(account.id, monthStart, monthEnd).first<{ used: number }>(),
        account.tenant_id
          ? db.prepare('SELECT plan_key, plan_status FROM tenants WHERE id = ?')
              .bind(account.tenant_id).first<{ plan_key: string | null; plan_status: string }>()
          : Promise.resolve(null),
        db.prepare(
          `SELECT COALESCE(SUM(total_count), 0) AS planned
             FROM broadcasts
            WHERE status = 'scheduled'
              AND (line_account_id = ? OR EXISTS (
                SELECT 1 FROM json_each(COALESCE(account_ids, '[]')) WHERE value = ?
              ))`,
        ).bind(account.id, account.id).first<{ planned: number }>(),
      ]);

      const harnessUsed = Number(harnessUsedRow?.used ?? 0);
      const harnessLimit = tenantRow ? findPlan(tenantRow.plan_key)?.monthlyMessages ?? null : null;
      const scheduledPlanned = Number(scheduledRow?.planned ?? 0);

      if (quota.limit === null && harnessLimit === null) {
        return result('message_quota', 'unknown', 'LINEとHarnessの配信上限をどちらも取得できませんでした', 'line_messaging_api', observedAt);
      }
      const lineRemaining = quota.limit === null || quota.used === null
        ? null : Math.max(0, quota.limit - quota.used);
      const harnessRemaining = harnessLimit === null
        ? null : Math.max(0, harnessLimit - harnessUsed);
      // 実際に送れる残数は小さい方。片側だけの「余裕あり」はしない。
      const sendable = lineRemaining === null ? harnessRemaining
        : harnessRemaining === null ? lineRemaining
        : Math.min(lineRemaining, harnessRemaining);
      const lineRatio = quota.limit === null || quota.used === null ? null
        : quota.limit === 0 ? 1 : Number(quota.used) / Number(quota.limit);
      const harnessRatio = harnessLimit === null ? null
        : harnessLimit === 0 ? 1 : harnessUsed / harnessLimit;
      // 取得できた側のうち「使用率の高い方」で判定する。残数の小さい側で判定すると、
      // 両側の残数が近いときに見る側が入れ替わるだけで、使用率が跳ねて
      // 正常↔注意を5分ごとに往復する（通知のばたつきの原因）。
      const ratios = [lineRatio, harnessRatio].filter((ratio): ratio is number => ratio !== null);
      const bindingRatio = ratios.length === 0 ? null : Math.max(...ratios);
      const forecastRemaining = sendable === null ? null : sendable - scheduledPlanned;
      const status: OperationHealthStatus = bindingRatio === null
        ? 'unknown'
        : bindingRatio >= 0.95 || (forecastRemaining !== null && forecastRemaining < 0) ? 'danger'
        : bindingRatio >= 0.8 ? 'warning'
        : 'normal';
      return result('message_quota', status,
        status === 'normal' ? '今月の配信枠に余裕があります'
          : forecastRemaining !== null && forecastRemaining < 0
            ? '予定済みの配信を送ると、今月の配信枠を超える見込みです'
            : '今月の配信枠が少なくなっています',
        'line_messaging_api', observedAt,
        {
          line: { used: quota.used, limit: quota.limit, remaining: lineRemaining },
          harness: { used: harnessUsed, limit: harnessLimit, remaining: harnessRemaining },
          sendable, scheduledPlanned, forecastRemaining, resetAt, timezone: 'Asia/Tokyo',
        },
        { warningRatio: 0.8, dangerRatio: 0.95 });
    }),
    isolate('external_integrations', observedAt, async () => {
      const row = await db.prepare(
        `SELECT COUNT(*) AS active_count,
                COALESCE(SUM(CASE WHEN consecutive_failures > 0 THEN 1 ELSE 0 END), 0) AS failing_count,
                COALESCE(MAX(consecutive_failures), 0) AS max_failures
           FROM outgoing_webhooks WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL`,
      ).bind(account.id).first<{ active_count: number; failing_count: number; max_failures: number }>();
      // #838 第2段: Google Sheets 連携の連続失敗・要再接続も同じ確認に畳む。
      // 要再接続（expired）は連続失敗カウンタと別系のため、警告側の件数に足す。
      const sheets = await db.prepare(
        `SELECT COUNT(*) AS active_count,
                COALESCE(SUM(CASE WHEN consecutive_failures > 0 OR status = 'expired' THEN 1 ELSE 0 END), 0) AS failing_count,
                COALESCE(MAX(consecutive_failures), 0) AS max_failures
           FROM google_sheets_integrations WHERE line_account_id = ?`,
      ).bind(account.id).first<{ active_count: number; failing_count: number; max_failures: number }>();
      const failing = Number(row?.failing_count ?? 0) + Number(sheets?.failing_count ?? 0);
      const maxFailures = Math.max(Number(row?.max_failures ?? 0), Number(sheets?.max_failures ?? 0));
      const status: OperationHealthStatus = maxFailures >= 3 ? 'danger' : failing > 0 ? 'warning' : 'normal';
      return result('external_integrations', status,
        status === 'normal' ? '外部連携に連続失敗はありません' : '外部連携に連続失敗があります',
        'outgoing_webhooks', observedAt,
        {
          activeCount: Number(row?.active_count ?? 0) + Number(sheets?.active_count ?? 0),
          failingCount: failing,
          maxConsecutiveFailures: maxFailures,
        },
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
        // 受信が無いのは「誰も送ってこなかった」だけのことが多い。これを異常にすると
        // 静かな時間帯ごとに知らせが鳴る。普段は受信があるのに1日止まった時だけ注意にする。
        const span = await db.prepare(
          `SELECT MAX(received_at) AS last_received_at,
                  COALESCE(SUM(CASE WHEN received_at >= datetime(?, '-24 hour') THEN 1 ELSE 0 END), 0) AS day_count,
                  COUNT(*) AS week_count
             FROM line_webhook_events
            WHERE line_account_id = ? AND received_at >= datetime(?, '-7 day')`,
        ).bind(observedAt, account.id, observedAt).first<{
          last_received_at: string | null; day_count: number; week_count: number;
        }>();
        const silent = Number(span?.day_count ?? 0) === 0 && Number(span?.week_count ?? 0) > 0;
        return result('webhook', silent ? 'warning' : 'normal',
          silent ? '24時間以上Webhookの受信がありません' : '直近1時間のWebhook受信はありません（普段どおりの範囲です）',
          'line_webhook_events', observedAt,
          {
            eventCount: 0, failedCount: 0,
            lastReceivedAt: span?.last_received_at ?? null,
            received24h: Number(span?.day_count ?? 0), received7d: Number(span?.week_count ?? 0),
          },
          { silentHours: 24 });
      }
      const failed = Number(row.failed_count);
      const status: OperationHealthStatus = failed >= 3 ? 'danger' : failed > 0 ? 'warning' : 'normal';
      return result('webhook', status,
        status === 'normal' ? 'Webhook受信は正常です' : 'Webhook受信に失敗があります',
        'line_webhook_events', observedAt,
        { eventCount: Number(row.event_count), failedCount: failed, lastReceivedAt: row.last_received_at },
        { warningFailures: 1, dangerFailures: 3 });
    }),
    isolate('dispatch_jobs', observedAt,
      () => collectOperationDispatchHealth(db, account.id, observedAt)),
    isolate('friend_change', observedAt, async () => {
      // 前日比だけでなく、同曜日（7日前）と過去28日の最大を baseline にする。
      // 小規模アカウントの減少を%だけで拾わないよう、絶対人数の下限を併用する
      // （v6-32 §5-6）。webhook取りこぼしの見せかけの減少は、同曜日baseline
      // より上なら異常としない。
      const rows = await db.prepare(
        `SELECT date, active, added, blocked
           FROM friend_daily_snapshots WHERE line_account_id = ?
          ORDER BY date DESC LIMIT 28`,
      ).bind(account.id).all<{ date: string; active: number; added: number; blocked: number }>();
      const snapshots = rows.results ?? [];
      const latest = snapshots[0];
      const previous = snapshots[1];
      if (!latest || !previous) {
        return result('friend_change', 'unknown', '友だち変化の比較記録が足りません', 'friend_daily_snapshots', observedAt);
      }
      const sameWeekday = snapshots.find((row) => {
        const day = Date.parse(`${row.date}T00:00:00Z`);
        const latestDay = Date.parse(`${latest.date}T00:00:00Z`);
        return latestDay - day === 7 * 24 * 60 * 60 * 1000;
      });
      const baselineMax = Math.max(...snapshots.map((row) => row.active));
      const delta = latest.active - previous.active;
      const ratio = previous.active > 0 ? delta / previous.active : 0;
      const weekdayDelta = sameWeekday ? latest.active - sameWeekday.active : null;
      const weekdayRatio = sameWeekday && sameWeekday.active > 0
        ? latest.active / sameWeekday.active - 1 : null;
      const bigEnough = Math.abs(Math.min(delta, 0)) >= FRIEND_DECREASE_MIN_ABSOLUTE;
      const realDrop = weekdayRatio === null || weekdayRatio <= FRIEND_DECREASE_WARNING_RATIO;
      const status: OperationHealthStatus =
        !(bigEnough && realDrop) ? 'normal'
        : ratio <= FRIEND_DECREASE_DANGER_RATIO ? 'danger'
        : ratio <= FRIEND_DECREASE_WARNING_RATIO ? 'warning'
        : 'normal';
      return result('friend_change', status,
        status === 'normal' ? '友だち数に大きな減少はありません' : '友だち数が大きく減少しています',
        'friend_daily_snapshots', observedAt,
        {
          active: latest.active, added: latest.added, blocked: latest.blocked,
          delta, changeRatio: ratio,
          sameWeekday: sameWeekday ? { date: sameWeekday.date, active: sameWeekday.active, delta: weekdayDelta } : null,
          baselineMax28d: baselineMax,
        },
        {
          warningDecreaseRatio: FRIEND_DECREASE_WARNING_RATIO,
          dangerDecreaseRatio: FRIEND_DECREASE_DANGER_RATIO,
          minAbsoluteDecrease: FRIEND_DECREASE_MIN_ABSOLUTE,
        });
    }),
    isolate('credential_expiry', observedAt, async () => {
      if (!account.token_expires_at) {
        return result('credential_expiry', 'unknown', 'LINEの鍵の期限がまだ記録されていません', 'line_accounts', observedAt);
      }
      const expiresAt = Date.parse(account.token_expires_at);
      const daysLeft = Math.floor((expiresAt - Date.parse(observedAt)) / (24 * 60 * 60 * 1000));
      const status: OperationHealthStatus =
        daysLeft < 0 ? 'danger' : daysLeft <= CREDENTIAL_WARNING_DAYS ? 'warning' : 'normal';
      return result('credential_expiry', status,
        status === 'normal' ? 'LINEの鍵の期限に余裕があります'
          : daysLeft < 0 ? 'LINEの鍵の期限が切れています'
          : `LINEの鍵の期限が${daysLeft}日後に迫っています`,
        'line_accounts', observedAt,
        { expiresAt: account.token_expires_at, daysLeft },
        { warningDays: CREDENTIAL_WARNING_DAYS });
    }),
    isolate('infra_canary', observedAt, async () => {
      // 実際に読み書きして試す。1回の失敗では知らせず、遅い・失敗が
      // 3回続いたときだけ異常にする（v6-32 §5-3）。
      const targets: Array<{ kind: string; ok: boolean; ms: number; note?: string }> = [];
      const probe = async (kind: string, run: () => Promise<void>) => {
        const started = Date.now();
        try {
          await run();
          targets.push({ kind, ok: true, ms: Date.now() - started });
        } catch {
          targets.push({ kind, ok: false, ms: Date.now() - started });
        }
      };
      const probeId = crypto.randomUUID();
      await probe('d1', async () => {
        await db.batch([
          db.prepare('INSERT INTO operation_infra_probes (id, kind, payload, created_at) VALUES (?, ?, ?, ?)')
            .bind(probeId, 'd1', probeId.slice(0, 8), observedAt),
          db.prepare('SELECT payload FROM operation_infra_probes WHERE id = ?').bind(probeId),
          db.prepare('DELETE FROM operation_infra_probes WHERE id = ?').bind(probeId),
          db.prepare("DELETE FROM operation_infra_probes WHERE created_at < datetime(?, '-1 day')")
            .bind(observedAt),
        ]);
      });
      if (deps.r2) {
        const key = `ops-health-probe/${probeId}`;
        await probe('r2', async () => {
          await deps.r2!.put(key, probeId);
          const got = await deps.r2!.get(key);
          await deps.r2!.delete(key);
          if (!got) throw new Error('r2_probe_read_failed');
        });
      } else {
        targets.push({ kind: 'r2', ok: true, ms: 0, note: '束縛なし' });
      }
      // Queue の試送信はconsumer側の型を壊す恐れがあるため、束縛の有無だけを見る。
      targets.push({ kind: 'queue', ok: true, ms: 0, note: deps.queue ? '束縛あり（送信は既存の経路で観測）' : '束縛なし' });
      targets.push({ kind: 'kv', ok: true, ms: 0, note: '束縛なし' });

      const thresholds = {
        slowMs: INFRA_SLOW_MS,
        alertAfter: INFRA_ALERT_AFTER,
        recoverAfter: INFRA_RECOVER_AFTER,
      };
      const failing = targets.filter((target) => !target.ok || target.ms >= INFRA_SLOW_MS);
      // 知らせている最中かどうかを先に見る。開くのは3回連続の失敗、閉じるのは1回の成功、
      // という左右の違いがあると、たまに失敗する不調で「異常→解消→再発」を5分ごとに
      // 繰り返してしまう。開くのも閉じるのも3回連続で揃える。
      const recent = await recentCheckResults(db, account.id, 'infra_canary', INFRA_RECOVER_AFTER - 1);
      const holding = holdingSeverity(recent);
      if (failing.length === 0) {
        let cleanStreak = 1;
        for (const row of recent) {
          if (row.failed) break;
          cleanStreak += 1;
        }
        if (holding && cleanStreak < INFRA_RECOVER_AFTER) {
          return result('infra_canary', holding,
            `データの置き場の試しは回復しつつあります（${cleanStreak}/${INFRA_RECOVER_AFTER}回連続で成功）`,
            'infra_canary', observedAt,
            { targets, failed: false, cleanStreak }, thresholds);
        }
        return result('infra_canary', 'normal', 'データの置き場への読み書きは正常です', 'infra_canary', observedAt,
          { targets, failed: false, cleanStreak }, thresholds);
      }
      // 失敗（つながらない・読み書きできない）は「エラー」、遅いだけなら「注意」に分ける。
      const severity: 'danger' | 'warning' = failing.some((target) => !target.ok) ? 'danger' : 'warning';
      const consecutive = await countRecentFailures(db, account.id, 'infra_canary', INFRA_ALERT_AFTER - 1) + 1;
      if (consecutive >= INFRA_ALERT_AFTER) {
        return result('infra_canary', severity,
          severity === 'danger'
            ? `データの置き場の試しが${consecutive}回続けて失敗しています`
            : `データの置き場の応答が${consecutive}回続けて遅くなっています`,
          'infra_canary', observedAt,
          { targets, consecutive, failed: true }, thresholds);
      }
      // まだ3回に達していない。ただし知らせている最中なら正常へ戻さない（上と同じ理由）。
      return result('infra_canary', holding ?? 'normal',
        `データの置き場の試しで失敗・遅延を記録（${consecutive}回連続・${INFRA_ALERT_AFTER}回続くとお知らせ）`,
        'infra_canary', observedAt,
        { targets, consecutive, failed: true }, thresholds);
    }),
    isolate('monitoring_heartbeat', observedAt, async () => {
      // 見張り自体が5分ごとに回っているか。直近の scheduled run の完了から
      // 2周期（10分）を超えていたら、見張りが止まっているとみなす。
      const row = await db.prepare(
        `SELECT started_at, completed_at FROM operation_health_runs
          WHERE scope_key = ? AND source = 'scheduled' AND status = 'completed'
          ORDER BY started_at DESC, id DESC LIMIT 1`,
      ).bind(account.id).first<{ started_at: string; completed_at: string }>();
      if (!row?.completed_at) {
        return result('monitoring_heartbeat', 'unknown',
          '定期確認の完了記録がまだありません', 'operation_health_runs', observedAt);
      }
      const elapsedMinutes = (Date.parse(observedAt) - Date.parse(row.completed_at)) / 60_000;
      const status: OperationHealthStatus = elapsedMinutes > 10 ? 'danger' : 'normal';
      return result('monitoring_heartbeat', status,
        status === 'normal' ? '定期確認は時刻どおり動いています' : '定期確認が10分以上止まっています',
        'operation_health_runs', observedAt,
        { lastCompletedAt: row.completed_at, elapsedMinutes: Math.round(elapsedMinutes) },
        { dangerMinutes: 10 });
    }),
  ]);
}

export async function runOperationHealthChecks(
  db: D1Database,
  input: {
    lineAccountId: string;
    source: 'scheduled' | 'manual';
    actorId?: string | null;
    now?: string;
    deps?: OperationInfraDeps;
  },
) {
  const started = await startOperationHealthRun(db, input);
  if (!started.created) {
    if (started.run.status === 'completed') {
      await reconcileOperationHealthAlerts(db, {
        lineAccountId: input.lineAccountId, runId: started.run.id, results: started.run.results,
      });
      await enqueuePendingOperationAlertNotifications(db, { lineAccountId: input.lineAccountId });
    }
    return { duplicate: true, run: started.run };
  }
  let completed = false;
  try {
    const account = await db.prepare(
      'SELECT id, channel_access_token, is_active, token_expires_at, tenant_id FROM line_accounts WHERE id = ?',
    ).bind(input.lineAccountId).first<AccountRow>();
    if (!account || account.is_active !== 1) throw new Error('line_account_not_active');
    const observedAt = input.now ?? new Date().toISOString();
    const results = await collectChecks(db, account, observedAt, input.deps ?? {});
    const run = await completeOperationHealthRun(db, started.run.id, results, observedAt);
    completed = true;
    await reconcileOperationHealthAlerts(db, { lineAccountId: input.lineAccountId, runId: run.id, results: run.results });
    await enqueuePendingOperationAlertNotifications(db, { lineAccountId: input.lineAccountId });
    return { duplicate: false, run };
  } catch (error) {
    if (!completed) {
      await failOperationHealthRun(db, started.run.id,
        error instanceof Error ? error.message : 'health_check_failed');
    }
    throw error;
  }
}

export async function runScheduledOperationHealthChecks(
  db: D1Database,
  deps: OperationInfraDeps = {},
): Promise<void> {
  const rows = await db.prepare('SELECT id FROM line_accounts WHERE is_active = 1 ORDER BY id')
    .all<{ id: string }>();
  await Promise.allSettled((rows.results ?? []).map((account) =>
    runOperationHealthChecks(db, { lineAccountId: account.id, source: 'scheduled', deps })));
}
