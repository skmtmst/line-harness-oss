import {sendRecordedNotification,NotificationDeliveryIncomplete} from './recorded-notification-send.js';
import { LineClient } from '@line-crm/line-sdk';

import type { Env } from '../worker-env.js';

type OutboxRow = {
  id: string;
  channel: 'line' | 'email';
  event_kind: 'stopped' | 'restored';
  payload_json: string;
  attempt_count:number;
  line_account_id:string|null;
};

type RecipientRow = { email: string | null; line_user_id: string | null };

export async function sendOperationEmail(
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
    `SELECT o.id, o.channel, o.event_kind, o.payload_json, o.attempt_count, i.line_account_id
       FROM operation_notification_outbox o JOIN operation_incidents i ON i.id=o.incident_id
      WHERE o. status IN ('queued', 'failed') AND o.next_attempt_at <= ?
      ORDER BY o.next_attempt_at, o.id LIMIT ?`,
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
      let payload:Record<string,unknown>={};
      try{payload=JSON.parse(row.payload_json)}catch{/* safe fallback */}
      const frozen=Array.isArray(payload.notificationRecipients)?payload.notificationRecipients.filter((v):v is string=>typeof v==='string'):null;
      const targets=frozen??[...new Set((recipients.results??[]).map(r=>row.channel==='line'?r.line_user_id:r.email).filter((v):v is string=>Boolean(v)))];
      if(!frozen){
        const saved = await env.DB.prepare("UPDATE operation_notification_outbox SET payload_json=? WHERE id=? AND status='sending' AND attempt_count=?")
          .bind(JSON.stringify({...payload,notificationRecipients:targets}),row.id,row.attempt_count+1).run();
        if (Number(saved.meta?.changes ?? 0) !== 1) throw new NotificationDeliveryIncomplete('failed');
      }
      const client=row.channel==='line'?new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN):null;
      const failures: Array<'failed' | 'unknown'> = [];
      for(const recipient of targets){
        try{
          await sendRecordedNotification(env.DB,{sourceId:`operation:${row.id}`,channel:row.channel,recipient,
            lineAccountId:row.line_account_id,payload:text,
            send:key=>client?client.pushMessage(recipient,[{type:'text',text}],key):
              sendOperationEmail(env,{to:recipient,subject:'【musubo】運用状態の重要なお知らせ',body:text}),
          });
        }catch(error){
          failures.push(error instanceof NotificationDeliveryIncomplete && error.deliveryStatus === 'failed' ? 'failed' : 'unknown');
        }
      }
      if(failures.length)throw new NotificationDeliveryIncomplete(failures.includes('unknown') ? 'unknown' : 'failed');
      const completed = await env.DB.prepare(
        `UPDATE operation_notification_outbox
            SET status = 'sent', sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status='sending' AND attempt_count=?`,
      ).bind(now, now, row.id,row.attempt_count+1).run();
      if (Number(completed.meta?.changes ?? 0) !== 1) throw new NotificationDeliveryIncomplete('unknown');
      sent += 1;
    } catch (error) {
      const message = error instanceof NotificationDeliveryIncomplete&&error.deliveryStatus==='failed'?'notification_delivery_failed':'notification_delivery_unknown';
      await env.DB.prepare(
        `UPDATE operation_notification_outbox
            SET status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status='sending' AND attempt_count=?`,
      ).bind(message, new Date(Date.now() + 5 * 60_000).toISOString(), now, row.id,row.attempt_count+1).run();
      failed += 1;
    }
  }
  return { sent, failed };
}
