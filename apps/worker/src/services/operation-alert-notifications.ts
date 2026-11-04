import { LineClient } from '@line-crm/line-sdk';

import type { Env } from '../worker-env.js';
import { fetchQuotaDetails } from '../features/broadcasts/broadcast-quota-guard/index.js';
import { sendOperationEmail } from './operation-notifications.js';
import { renderMailHtml } from './mail-html.js';

type OutboxRow = {
  id: string;
  line_account_id: string;
  channel: 'line' | 'email';
  staff_id: string;
  email: string | null;
  line_user_id: string | null;
  channel_access_token: string | null;
  action: 'opened' | 'escalated' | 'acknowledged' | 'resolved' | 'reopened';
  severity: 'unknown' | 'warning' | 'danger';
  summary: string;
  check_key: string;
};

export const OPERATION_ALERT_NOTIFICATION_LEASE_MS = 10 * 60_000;
// 運用アラートは管理画面にも残る。古い通知だけで月初のLINE配信枠を消費しない。
const LINE_ALERT_MAX_AGE_MS = 6 * 60 * 60_000;
const LINE_ALERT_MAX_ATTEMPTS = 24;
const LINE_ALERT_MONTHLY_MAX = 20;
const JST_OFFSET_MS = 9 * 60 * 60_000;

function jstMonthBoundsUtc(now: Date): { start: string; end: string } {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, -9)).toISOString(),
    end: new Date(Date.UTC(year, month + 1, 1, -9)).toISOString(),
  };
}

/**
 * 解消・確認の知らせに使う短い名前。summaryは「〜があります」という
 * 問題の説明なので、解消の文面には使わない。
 */
const OPERATION_ALERT_CHECK_SHORT_NAMES: Record<string, string> = {
  line_connection: 'LINE接続',
  message_quota: '配信数の上限',
  external_integrations: '外部連携',
  webhook: 'Webhook受信',
  dispatch_jobs: '配信処理',
  friend_change: '友だち数の変化',
  monitoring_heartbeat: '定期確認',
  infra_canary: '基盤の確認',
  credential_expiry: '接続情報の期限',
};

function alertText(row: OutboxRow): string {
  const footer = '管理画面の運用状態で確認してください。';
  const shortName = OPERATION_ALERT_CHECK_SHORT_NAMES[row.check_key] ?? '運用状態';
  // 解消と確認はもう起きている知らせなので、重さの札（エラー・注意・未確認）を付けない。
  if (row.action === 'resolved') {
    return `【運用状態】解消しました：${shortName}\n${footer}`;
  }
  if (row.action === 'acknowledged') {
    return `【運用状態】異常を確認しました：${shortName}\n${footer}`;
  }
  const action = row.action === 'opened' ? '異常を検知しました'
    : row.action === 'escalated' ? '異常の深刻度が上がりました'
      : '解消済みの異常が再発しました';
  const severity = row.severity === 'danger' ? 'エラー' : row.severity === 'warning' ? '注意' : '未確認';
  return `【運用状態】${action}（${severity}）\n${row.summary}\n${footer}`;
}

/**
 * alert eventごとのstaff/channel行を先にclaimするため、cronの重複起動や
 * 手動再送が重なっても同じ通知を同時に送らない。外部送信の失敗は成功扱いにしない。
 */
export async function processOperationAlertNotificationOutbox(
  env: Env['Bindings'],
  limit = 50,
): Promise<{ sent: number; failed: number }> {
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.parse(now) + OPERATION_ALERT_NOTIFICATION_LEASE_MS).toISOString();
  const freshnessCutoff = new Date(Date.parse(now) - LINE_ALERT_MAX_AGE_MS).toISOString();
  const month = jstMonthBoundsUtc(new Date(now));
  const quotaByAccount = new Map<string, ReturnType<typeof fetchQuotaDetails>>();
  // 設定をオフにする前に積まれた行も送らない。削除して再試行対象から外す。
  await env.DB.prepare(
    `DELETE FROM operation_alert_notification_outbox
      WHERE status IN ('queued', 'failed', 'sending')
        AND EXISTS (
          SELECT 1 FROM staff_members sm
           WHERE sm.id = operation_alert_notification_outbox.staff_id
             AND json_valid(sm.notification_preferences)
             AND CASE operation_alert_notification_outbox.channel
                   WHEN 'line' THEN json_extract(sm.notification_preferences, '$.operations.line')
                   ELSE json_extract(sm.notification_preferences, '$.operations.email')
                 END = 0
        )`,
  ).run();
  /*
   * アカウント停止中（X-1）。そのアカウントの経路では通知を出さない。
   * 滞留させると再開時に古い通知がまとめて出るので、送れなかった分は
   * 失敗行として残す。
   */
  await env.DB.prepare(
    `UPDATE operation_alert_notification_outbox
        SET status = 'failed', last_error = 'account_inactive', updated_at = ?
      WHERE status IN ('queued', 'failed', 'sending')
        AND EXISTS (
          SELECT 1 FROM line_accounts la
           WHERE la.id = operation_alert_notification_outbox.line_account_id
             AND la.is_active = 0
        )`,
  ).bind(now).run();
  const rows = await env.DB.prepare(
    `SELECT o.id, o.line_account_id, o.channel, o.staff_id, sm.email, sm.line_user_id, la.channel_access_token,
            e.action, e.severity, e.summary, a.check_key
       FROM operation_alert_notification_outbox o
       JOIN operation_alert_events e ON e.id = o.event_id
       JOIN operation_alerts a ON a.id = e.alert_id
       JOIN staff_members sm ON sm.id = o.staff_id
       JOIN line_accounts la ON la.id = o.line_account_id
      WHERE o.status IN ('queued', 'failed', 'sending') AND o.next_attempt_at <= ?
        AND la.is_active = 1 AND COALESCE(o.last_error, '') != 'account_inactive'
        AND (o.channel != 'line' OR (e.created_at >= ? AND o.attempt_count < ?))
      ORDER BY o.next_attempt_at, o.id LIMIT ?`,
  ).bind(now, freshnessCutoff, LINE_ALERT_MAX_ATTEMPTS, Math.max(1, Math.min(limit, 100))).all<OutboxRow>();
  let sent = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    if (row.channel === 'line') {
      if (!row.channel_access_token) continue;
      const quotaPromise = quotaByAccount.get(row.line_account_id) ?? fetchQuotaDetails(row.channel_access_token);
      quotaByAccount.set(row.line_account_id, quotaPromise);
      const quota = await quotaPromise;
      // 使用数を確認できない場合は運用アラートを送らず、顧客向けの枠を優先する。
      if (quota.used === null || quota.failures.length > 0) continue;
      if (quota.limit !== null) {
        const reserve = Math.max(1, Math.ceil(quota.limit * 0.1));
        if (quota.used >= quota.limit - reserve) continue;
      }
    }
    const claimed = await env.DB.prepare(
      `UPDATE operation_alert_notification_outbox
          SET status = 'sending', attempt_count = attempt_count + 1,
              next_attempt_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'failed', 'sending') AND next_attempt_at <= ?
          AND (channel != 'line' OR (attempt_count < ? AND EXISTS (
            SELECT 1 FROM operation_alert_events e
             WHERE e.id = operation_alert_notification_outbox.event_id AND e.created_at >= ?
          )))
          AND (channel != 'line' OR (
            SELECT COUNT(*) FROM operation_alert_notification_outbox counted
             WHERE counted.line_account_id = operation_alert_notification_outbox.line_account_id
               AND counted.channel = 'line'
               AND ((counted.status = 'sent' AND counted.sent_at >= ? AND counted.sent_at < ?)
                 OR (counted.status = 'sending' AND counted.updated_at >= ? AND counted.updated_at < ?))
          ) < ?)
          AND COALESCE(last_error, '') != 'account_inactive'
          AND NOT EXISTS (SELECT 1 FROM staff_members sm
            WHERE sm.id = operation_alert_notification_outbox.staff_id
              AND json_valid(sm.notification_preferences)
              AND CASE operation_alert_notification_outbox.channel
                    WHEN 'line' THEN json_extract(sm.notification_preferences, '$.operations.line')
                    ELSE json_extract(sm.notification_preferences, '$.operations.email')
                  END = 0)
          AND EXISTS (SELECT 1 FROM line_accounts la
            WHERE la.id = operation_alert_notification_outbox.line_account_id AND la.is_active = 1)`,
    ).bind(leaseExpiresAt, now, row.id, now, LINE_ALERT_MAX_ATTEMPTS, freshnessCutoff,
      month.start, month.end, month.start, month.end, LINE_ALERT_MONTHLY_MAX).run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) continue;
    try {
      const text = alertText(row);
      if (row.channel === 'line') {
        if (!row.line_user_id || !row.channel_access_token) throw new Error('alert_line_recipient_unavailable');
        await new LineClient(row.channel_access_token).pushMessageWithRequestId(
          row.line_user_id, [{ type: 'text', text }], row.id,
        );
      } else {
        if (!row.email) throw new Error('alert_email_recipient_unavailable');
        await sendOperationEmail(env, {
          to: row.email,
          subject: '【musubo】運用状態の確認が必要です',
          body: text,
          html: renderMailHtml({ heading: '運用状態の確認が必要です', paragraphs: [text] }),
        });
      }
      await env.DB.prepare(
        `UPDATE operation_alert_notification_outbox
            SET status = 'sent', sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
      ).bind(now, now, row.id).run();
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'operation_alert_notification_failed';
      await env.DB.prepare(
        `UPDATE operation_alert_notification_outbox
            SET status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(message, new Date(Date.now() + 5 * 60_000).toISOString(), now, row.id).run();
      failed += 1;
    }
  }
  return { sent, failed };
}
