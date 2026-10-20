import { EntitlementError, entitlementMonth, entitlementViews } from '../features/booking/booking-entitlements/index.js';
import { getAccountTimeZone } from './availability.js';

/** Event scopes are opt-in. A menu-only or another person's grant cannot pay for a class. */
export async function validateEventEntitlement(db: D1Database, account: string, friend: string, event: string, id: string, at: string) {
  const grant = (await entitlementViews(db, account, friend, at)).find(row => row.id === id);
  const plan = await db.prepare(`SELECT p.event_target_scope_json,e.billing_status,e.grace_until
    FROM booking_entitlements e JOIN booking_pass_plans p ON p.id=e.plan_id AND p.line_account_id=e.line_account_id
    JOIN events ev ON ev.id=? AND ev.line_account_id=e.line_account_id
    WHERE e.id=? AND e.line_account_id=? AND e.friend_id=?`).bind(event,id, account, friend)
    .first<{ event_target_scope_json: string | null; billing_status: string; grace_until: string | null }>();
  const scope = plan?.event_target_scope_json == null ? null : JSON.parse(plan.event_target_scope_json) as string[];
  if (!grant || grant.status !== 'active' || grant.menu_id || scope === null || scope.length > 0 && !scope.includes(event)
    || plan?.billing_status === 'stopped' || plan?.billing_status === 'grace' && plan.grace_until && Date.parse(plan.grace_until) <= Date.now()
    || Date.parse(at) < Date.parse(grant.valid_from) || Date.parse(at) >= Date.parse(grant.expires_at)
    || (grant.kind === 'ticket' ? Number(grant.remaining) <= 0 : grant.monthRemaining !== null && grant.monthRemaining <= 0)) {
    throw new EntitlementError('entitlement_unavailable', 409);
  }
  return grant;
}

export async function eventEntitlementUse(db: D1Database, account: string, booking: string, id: string, at: string) {
  const period = entitlementMonth(at, await getAccountTimeZone(db, account));
  return db.prepare(`INSERT INTO event_booking_entitlement_uses
    (event_booking_id,event_booking_id_history,line_account_id,event_id,slot_id,starts_at,entitlement_id,period_start,period_end,operation_key,created_at,updated_at)
    SELECT b.id,b.id,b.line_account_id,b.event_id,b.slot_id,s.starts_at,?,?,?,'event-use:'||b.id,?,?
    FROM event_bookings b JOIN event_slots s ON s.id=b.slot_id WHERE b.id=? AND b.line_account_id=?`)
    .bind(id, period.periodStart, period.periodEnd, new Date().toISOString(), new Date().toISOString(), booking, account);
}

/** Run after the cancellation fence succeeds, never while a temporary status can still be rolled back. */
export async function returnEventEntitlement(db: D1Database, account: string, booking: string, expectedVersion?: number) {
  await db.prepare(`UPDATE event_booking_entitlement_uses SET returned_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1
    WHERE event_booking_id=? AND line_account_id=? AND consumed_at IS NOT NULL AND returned_at IS NULL
      AND makeup_credit_id IS NULL AND EXISTS(SELECT 1 FROM event_bookings b JOIN events e ON e.id=b.event_id JOIN event_slots s ON s.id=b.slot_id
        WHERE b.id=event_booking_id AND b.line_account_id=? AND b.status='cancelled' AND b.absence_reported_at IS NULL
          AND (? IS NULL OR b.lock_version=?)
          AND julianday(s.starts_at)>=julianday(COALESCE(b.cancelled_at,b.updated_at))+COALESCE(CASE WHEN b.event_snapshot_json IS NOT NULL THEN json_extract(b.event_snapshot_json,'$.cancelDeadlineHoursBefore') ELSE e.cancel_deadline_hours_before END,24)/24.0)
      AND NOT EXISTS(SELECT 1 FROM booking_makeup_credits WHERE source_event_booking_id=event_booking_id)`)
    .bind(booking, account, account, expectedVersion ?? null, expectedVersion ?? null).run();
}

export async function transferEventEntitlement(db:D1Database,account:string,from:string,to:string,at:string) {
  const period=entitlementMonth(at,await getAccountTimeZone(db,account));
  return db.prepare(`UPDATE event_booking_entitlement_uses SET event_booking_id=?,
    slot_id=(SELECT slot_id FROM event_bookings WHERE id=?),starts_at=?,period_start=?,period_end=?,version=version+1
    WHERE event_booking_id=? AND line_account_id=? AND returned_at IS NULL
      AND EXISTS(SELECT 1 FROM event_bookings WHERE id=? AND line_account_id=?)`)
    .bind(to,to,at,period.periodStart,period.periodEnd,from,account,to,account);
}

export async function assertEventPassRequirement(db:D1Database,account:string,event:string,entitlement:unknown) {
  const required=await db.prepare(`SELECT id FROM booking_pass_plans WHERE line_account_id=? AND status!='draft'
    AND allow_without_pass=0 AND event_target_scope_json IS NOT NULL AND (json_array_length(event_target_scope_json)=0
    OR EXISTS(SELECT 1 FROM json_each(event_target_scope_json) WHERE value=?)) LIMIT 1`).bind(account,event).first();
  if(required&&!entitlement)throw new EntitlementError('pass_required',400);
}

/** Only an unaccepted, unchanged new request may be discarded. Unknown/sent notifications fence compensation. */
export async function discardUnacceptedEventBooking(db:D1Database,account:string,id:string) {
 const affected=`(json_extract(w.input_json,'$.snapshot.subject.bookingId')=? OR w.subject_id IN(
   SELECT r.id FROM event_booking_reminders r WHERE r.booking_id=? UNION ALL
   SELECT 'event-reminder:'||r.id FROM event_booking_reminders r WHERE r.booking_id=?))`;
 try{await db.batch([
   db.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM event_bookings WHERE id=? AND line_account_id=? AND lock_version=1 AND status IN('requested','confirmed'))
     AND NOT EXISTS(SELECT 1 FROM event_booking_reminders WHERE booking_id=? AND status IN('sent','failed_permanent'))
     AND NOT EXISTS(SELECT 1 FROM workflow_steps w WHERE w.scope_id=? AND ${affected} AND w.status IN('running','unknown','succeeded'))
     THEN 'true' ELSE 'event_booking_discard_conflict' END)`).bind(id,account,id,`line:${account}`,id,id,id),
   db.prepare("UPDATE event_booking_entitlement_uses SET returned_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE event_booking_id=? AND line_account_id=? AND consumed_at IS NOT NULL AND returned_at IS NULL").bind(id,account),
   db.prepare(`UPDATE workflow_steps AS w SET status='canceled',error_code='event_booking_rolled_back' WHERE scope_id=? AND status='pending' AND ${affected}`).bind(`line:${account}`,id,id,id),
   db.prepare("DELETE FROM event_booking_reminders WHERE booking_id=? AND status IN('pending','failed','cancelled')").bind(id),
   db.prepare('DELETE FROM event_bookings WHERE id=? AND line_account_id=? AND lock_version=1').bind(id,account),
   db.prepare("SELECT json(CASE WHEN changes()=1 THEN 'true' ELSE 'event_booking_discard_conflict' END)"),
 ]);}catch(error){if(error instanceof Error&&/event_booking_discard_conflict|malformed JSON/.test(error.message))throw new EntitlementError('booking_changed',409);throw error;}
}
