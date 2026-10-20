import { jstCalendar as japanCalendar } from '@line-crm/shared';
import { activeTenantLineAccountSql, type V6WriteGuard } from '@line-crm/db';
import { isOperationCapabilityStopped } from '@line-crm/db';

import { cancelByTrigger, reconcileV6ToStartsAt, enrollByTrigger } from './reminder-trigger.js';
import { cancelPendingRemindersFor } from './event-reminder-cleanup.js';
import { computeRemindersForBooking,insertRemindersForBooking } from './event-reminder-schedule.js';
import { enqueueEventWaitlistPromotion } from './event-waitlist.js';
import { returnEventEntitlement } from './event-entitlements.js';
import { prepareEventNotification } from './event-notification-plan.js';
import type { EventNotificationKind } from './event-booking-notifier.js';
import { featureJobCanRun } from './feature-enforcement.js';


type Transition = {id:string;line_account_id:string;event_id:string;booking_id:string;booking_version:number;
  operation_key:string;action:string;input_snapshot:string;steps_json:string};
type Snapshot={friendId:string;recipient:string;slotId:string;startsAt:string;status:string;eventName:string;venueName:string|null;venueUrl:string|null;cancelledBy?:string|null;replacementId?:string};
/** Recovery uses the original operation/version. A rollback also advances the version, invalidating old work. */
export async function recoverEventTransitions(db:D1Database,now:Date,limit:number):Promise<number> {
  if(limit<=0)return 0;
  const rows=await db.prepare(`SELECT t.* FROM event_booking_transition_runs t
    WHERE t.status='pending' AND ${activeTenantLineAccountSql('t.line_account_id')}
    ORDER BY t.created_at,t.id LIMIT ?`).bind(limit).all<Transition>();
  for(const row of rows.results) {
    const snapshot=JSON.parse(row.input_snapshot) as Snapshot;
    const current=async()=>!!await db.prepare(`SELECT 1 ok FROM event_bookings b JOIN event_slots s ON s.id=b.slot_id
      WHERE b.id=? AND b.line_account_id=? AND b.lock_version=? AND b.status=? AND b.slot_id=?
        AND julianday(s.starts_at)=julianday(?) AND b.friend_id=?`)
      .bind(row.booking_id,row.line_account_id,row.booking_version,snapshot.status,snapshot.slotId,snapshot.startsAt,snapshot.friendId).first();
    if(!await current()) {
      await db.prepare("UPDATE event_booking_transition_runs SET status='obsolete',updated_at=? WHERE id=? AND status='pending'")
        .bind(now.toISOString(),row.id).run();continue;
    }
    if(!await featureJobCanRun(db,{accountId:row.line_account_id,featureId:'events',job:'event transition recovery'})
      ||await isOperationCapabilityStopped(db,row.line_account_id,'reminder_dispatch'))continue;
    const guard:V6WriteGuard={sql:'EXISTS(SELECT 1 FROM event_bookings guard WHERE guard.id=? AND guard.line_account_id=? AND guard.lock_version=?)',binds:[row.booking_id,row.line_account_id,row.booking_version]};
    const base={triggerType:'event' as const,sourceId:row.booking_id,sourceEventId:row.booking_id,friendId:snapshot.friendId,
      lineAccountId:row.line_account_id,writeGuard:guard};
    const steps=JSON.parse(row.steps_json) as Record<string,unknown>;
    const save=async()=>{await db.prepare(`UPDATE event_booking_transition_runs SET steps_json=?,updated_at=?
      WHERE id=? AND status='pending' AND ${guard.sql}`).bind(JSON.stringify(steps),now.toISOString(),row.id,...guard.binds).run();};
    try {
      if(['cancelled','rejected','expired'].includes(snapshot.status)) {
        if(!steps.reminders) {
          await cancelByTrigger(db,{...base,startsAtIso:snapshot.startsAt,cancelReason:row.operation_key,failOnSendInFlight:true});
          if(!await current())continue;
          await cancelPendingRemindersFor(db,row.booking_id);
          steps.reminders='cancelled';await save();
        }
        await returnEventEntitlement(db,row.line_account_id,row.booking_id,row.booking_version);
        if(!steps.waitlist) {
          await enqueueEventWaitlistPromotion(db,{lineAccountId:row.line_account_id,eventId:row.event_id,occurrenceId:snapshot.slotId,
            sourceKey:row.action==='change_from'&&snapshot.replacementId?`booking-change:${snapshot.replacementId}`:`booking:${row.booking_id}:${snapshot.status}`});steps.waitlist='planned';await save();
        }
      } else if(snapshot.status==='confirmed' && !steps.reminders) {
        await reconcileV6ToStartsAt(db,{...base,startsAtIso:snapshot.startsAt});
        if(!await current())continue;
        await enrollByTrigger(db,{...base,eventId:row.event_id,startsAtIso:snapshot.startsAt});
        const config=await db.prepare('SELECT reminder_day_before_enabled,reminder_hours_before FROM events WHERE id=?')
          .bind(row.event_id).first<{reminder_day_before_enabled:number;reminder_hours_before:number|null}>();
        if(!await current())continue;
        if(config)await insertRemindersForBooking(db,row.booking_id,computeRemindersForBooking({starts_at_utc:snapshot.startsAt,
          reminder_day_before_enabled:config.reminder_day_before_enabled===1,reminder_hours_before:config.reminder_hours_before,now}));
        steps.reminders='planned';await save();
      }
      const kind:EventNotificationKind|null=row.action==='reject'?'rejected':row.action==='cancel'&&snapshot.cancelledBy!=='friend'?'cancelled_by_admin'
        :row.action==='schedule_changed'||row.action==='change_to'?'schedule_changed':row.action==='confirmed'?'confirmed':null;
      if(kind&&!steps.notification&&snapshot.recipient&&await current()) {
        const starts=japanCalendar(new Date(Date.parse(snapshot.startsAt))).toISOString();
        const plan=await prepareEventNotification(db,{accountId:row.line_account_id,operationId:row.operation_key,to:snapshot.recipient,kind,
          ctx:{eventName:snapshot.eventName,startsAtJst:`${starts.slice(0,10)} ${starts.slice(11,16)}`,venueName:snapshot.venueName,venueUrl:snapshot.venueUrl},
          subject:{bookingId:row.booking_id,slotId:snapshot.slotId,status:snapshot.status,startsAt:snapshot.startsAt,version:row.booking_version},now});
        await plan.run();steps.notification='planned';await save();
      }
      await db.prepare(`UPDATE event_booking_transition_runs SET status='complete',updated_at=? WHERE id=? AND status='pending' AND ${guard.sql}`)
        .bind(now.toISOString(),row.id,...guard.binds).run();
    }catch(error) {
      // No fresh send key and no increased retry budget. Busy send leases remain recoverable.
      steps.lastError=error instanceof Error&&error.message==='REMINDER_SEND_IN_FLIGHT'?'send_in_flight':'transition_incomplete';
      await save();
    }
  }
  return rows.results.length;
}
