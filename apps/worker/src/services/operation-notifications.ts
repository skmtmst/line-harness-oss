import { LineClient } from '@line-crm/line-sdk';

import type { Env } from '../index.js';

type OutboxRow = {
  id: string;
  channel: 'line' | 'email';
  event_kind: 'stopped' | 'restored';
  payload_json: string;
};

type RecipientRow = { email: string | null; line_user_id: string | null };

async function sendEmail(
  env: Env['Bindings'],
  input: { to: string; subject: string; body: string },
): Promise<void> {
  if (env.XSERVER_RELAY_URL && env.XSERVER_RELAY_SECRET) {
    const { sendViaXServerRelay } = await import('./support-relay.js');
    await sendViaXServerRelay(env.XSERVER_RELAY_URL, env.XSERVER_RELAY_SECRET, input);
    return;
  }
  const { sendXServerMail } = await import('./xserver-mail.js');
  await sendXServerMail(env, {
    ...input,
    from: env.CONTACT_EMAIL || env.XSERVER_MAIL_USER || 'contact-shed@nen-petfood.com',
  });
}

function notificationText(row: OutboxRow): string {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload_json) as Record<string, unknown>; } catch { /* use safe fallback */ }
  const reason = typeof payload.reason === 'string' ? `\n理由: ${payload.reason}` : '';
  return row.event_kind === 'stopped'
    ? `【重要】自動配信を緊急停止しました。${reason}`
    : '【重要】緊急停止から復旧しました。運用状態を確認してください。';
}

/** LINEとemailは別outbox rowをclaimするため、片方の障害がもう片方を止めない。 */
export async function processOperationNotificationOutbox(
  env: Env['Bindings'],
  limit = 20,
): Promise<{ sent: number; failed: number }> {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    `SELECT id, channel, event_kind, payload_json
       FROM operation_notification_outbox
      WHERE status IN ('queued', 'failed') AND next_attempt_at <= ?
      ORDER BY next_attempt_at, id LIMIT ?`,
  ).bind(now, Math.max(1, Math.min(limit, 100))).all<OutboxRow>();
  const recipients = await env.DB.prepare(
    `SELECT email, line_user_id FROM staff_members
      WHERE is_active = 1 AND (email IS NOT NULL OR line_user_id IS NOT NULL)`,
  ).all<RecipientRow>();
  let sent = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    const claimed = await env.DB.prepare(
      `UPDATE operation_notification_outbox
          SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'failed') AND next_attempt_at <= ?`,
    ).bind(now, row.id, now).run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) continue;
    const text = notificationText(row);
    try {
      if (row.channel === 'line') {
        const client = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
        for (const recipient of recipients.results ?? []) {
          if (recipient.line_user_id) await client.pushMessage(recipient.line_user_id, [{ type: 'text', text }]);
        }
      } else {
        for (const recipient of recipients.results ?? []) {
          if (recipient.email) await sendEmail(env, { to: recipient.email, subject: '【然-NEN-】運用状態の重要なお知らせ', body: text });
        }
      }
      await env.DB.prepare(
        `UPDATE operation_notification_outbox
            SET status = 'sent', sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
      ).bind(now, now, row.id).run();
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'notification_failed';
      await env.DB.prepare(
        `UPDATE operation_notification_outbox
            SET status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(message, new Date(Date.now() + 5 * 60_000).toISOString(), now, row.id).run();
      failed += 1;
    }
  }
  return { sent, failed };
}
