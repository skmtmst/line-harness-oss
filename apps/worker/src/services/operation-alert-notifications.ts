import { LineClient } from '@line-crm/line-sdk';

import type { Env } from '../index.js';
import { sendOperationEmail } from './operation-notifications.js';

type OutboxRow = {
  id: string;
  channel: 'line' | 'email';
  staff_id: string;
  email: string | null;
  line_user_id: string | null;
  channel_access_token: string | null;
  action: 'opened' | 'escalated' | 'acknowledged' | 'resolved' | 'reopened';
  severity: 'unknown' | 'warning' | 'danger';
  summary: string;
};

function alertText(row: OutboxRow): string {
  const action = row.action === 'opened' ? '異常を検知しました'
    : row.action === 'escalated' ? '異常の深刻度が上がりました'
      : row.action === 'reopened' ? '解消済みの異常が再発しました'
        : row.action === 'resolved' ? '異常が解消しました'
          : '異常を受領しました';
  const severity = row.severity === 'danger' ? 'エラー' : row.severity === 'warning' ? '注意' : '未確認';
  return `【運用状態】${action}（${severity}）\n${row.summary}\n管理画面の運用状態で確認してください。`;
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
  const rows = await env.DB.prepare(
    `SELECT o.id, o.channel, o.staff_id, sm.email, sm.line_user_id, la.channel_access_token,
            e.action, e.severity, e.summary
       FROM operation_alert_notification_outbox o
       JOIN operation_alert_events e ON e.id = o.event_id
       JOIN staff_members sm ON sm.id = o.staff_id
       JOIN line_accounts la ON la.id = o.line_account_id
      WHERE o.status IN ('queued', 'failed') AND o.next_attempt_at <= ?
      ORDER BY o.next_attempt_at, o.id LIMIT ?`,
  ).bind(now, Math.max(1, Math.min(limit, 100))).all<OutboxRow>();
  let sent = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    const claimed = await env.DB.prepare(
      `UPDATE operation_alert_notification_outbox
          SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'failed') AND next_attempt_at <= ?`,
    ).bind(now, row.id, now).run();
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
          subject: '【LINE Harness】運用状態の確認が必要です',
          body: text,
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
