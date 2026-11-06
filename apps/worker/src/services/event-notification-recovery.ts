import { activeTenantLineAccountSql, resolveLineCredential } from '@line-crm/db';
import { type Message } from '@line-crm/line-sdk';
import { currentEventNotificationSubject, type EventNotificationSubject } from './event-notification-subject.js';
import { sendPreparedEventBookingNotification } from './event-booking-notifier.js';
import { deliverBookingLine } from '../features/booking/booking-line-delivery/index.js';
import { featureJobCanRun } from './feature-enforcement.js';
import { isOperationCapabilityStopped } from '@line-crm/db';

export { currentEventNotificationSubject, type EventNotificationSubject } from './event-notification-subject.js';
/** 確定/受付の未実行通知は既存cron内で回収。不明の通知は対象にしない。 */
export async function recoverEventBookingNotifications(db:D1Database,now:Date,limit:number) {
  const result={sent:0,failed:0};if(limit<=0)return result;
  const rows=await db.prepare(`SELECT w.subject_id,w.input_json,a.id AS account_id,a.channel_access_token,a.channel_access_token_encrypted
    FROM workflow_steps w JOIN line_accounts a ON w.scope_id='line:'||a.id
    WHERE w.process_kind='booking_line_delivery' AND w.status='pending'
      AND json_type(w.input_json,'$.snapshot.subject.bookingId')='text'
      AND json_type(w.input_json,'$.snapshot.messages')='array'
      AND (w.next_attempt_at IS NULL OR w.next_attempt_at<=?) AND ${activeTenantLineAccountSql('a.id')}
    ORDER BY w.created_at,w.subject_id LIMIT ?`).bind(now.getTime(),limit).all<{
      subject_id:string;input_json:string;account_id:string;channel_access_token:string;channel_access_token_encrypted:string|null;
    }>();
  for(const row of rows.results??[]) {
    const saved=JSON.parse(row.input_json) as {identity:{scope:{accountId:string};idempotencyKey:string};policy:{deadlineAt:number};snapshot:{to:string;messages:Message[];subject:EventNotificationSubject}};
    const account=row.account_id;
    if(saved.identity.scope.accountId!==account)continue;
    if(!await featureJobCanRun(db,{accountId:account,featureId:'events',job:'event notification recovery'})
      ||await isOperationCapabilityStopped(db,account,'reminder_dispatch'))continue;
    if(!await currentEventNotificationSubject(db,account,saved.snapshot.subject,saved.snapshot.to)) {
      await db.prepare(`UPDATE workflow_steps SET status='canceled',error_code='event_notification_obsolete',updated_at=?
        WHERE scope_id=? AND process_kind='booking_line_delivery' AND subject_id=? AND step_key='send' AND status='pending'`)
        .bind(now.getTime(),`line:${account}`,row.subject_id).run();
      continue;
    }
    try {
      const token=await resolveLineCredential(row.channel_access_token_encrypted,row.channel_access_token,{lineAccountId:account,field:'channel_access_token'});
      await deliverBookingLine(db,{accountId:account,operationId:row.subject_id,retryKey:saved.identity.idempotencyKey,
        snapshot:saved.snapshot,deadlineAt:saved.policy.deadlineAt,now:()=>now.getTime(),
        authorize:async snapshot=>await currentEventNotificationSubject(db,account,snapshot.subject,snapshot.to)
          && !await isOperationCapabilityStopped(db,account,'reminder_dispatch')
          && await featureJobCanRun(db,{accountId:account,featureId:'events',job:'event notification recovery'}),
        send:(signal,snapshot,key)=>sendPreparedEventBookingNotification(token,snapshot,signal,key),
      });
      result.sent++;
    }catch{result.failed++;}
  }
  return result;
}
