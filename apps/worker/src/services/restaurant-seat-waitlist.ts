import { openSeatTables } from './restaurant-closures.js';
import type { Env } from '../index.js';
import { dispatchWaitlistInvites, finishExpiredWaitlists, waitlistHoldMinutes } from './booking-waitlist.js';
export const DEFAULT_SEAT_WAITLIST_HOLD_MINUTES = 30;
export interface SeatWaitlistSlot { storeId: string; startsAt: string; tableId: string; }
export interface SeatWaitlistEntry { id: string; store_id: string; starts_at: string; ends_at: string | null; guest_count: number; customer_name: string; customer_phone: string | null; line_uid: string | null; identity_key: string; status: string; hold_minutes: number; table_id: string | null; invited_at: string | null; hold_expires_at: string | null; notified_at: string | null; created_at: string; }
export type SeatPromoteResult = { promoted: true; entry: SeatWaitlistEntry ;} | { promoted: false; reason: 'empty' | 'hold_active' | 'race' | 'no_fitting_table' | 'unavailable' ;};
export async function fittingSeatTables(db: D1Database, storeId: string, guestCount: number): Promise<Array<{ id: string; label: string ;}>> {
  return (await db.prepare('SELECT id,label FROM rt_tables WHERE store_id=? AND is_active=1 AND min_capacity<=? AND max_capacity>=? ORDER BY max_capacity,id').bind(storeId, guestCount, guestCount).all<{ id: string; label: string ;}>()).results;
}
/** 先着順を守る。先頭の組が入る卓が無ければ、後ろの組は追い越さない。 */
export async function promoteSeatWaitlist(db: D1Database, slot: SeatWaitlistSlot, _sender?: unknown, liffBaseUrl = '', env?: Env['Bindings']): Promise<SeatPromoteResult> {
  const store = await db.prepare('SELECT line_account_id,status FROM rt_stores WHERE id=?').bind(slot.storeId).first<{ line_account_id: string | null; status: string ;}>();
  if (!store || store.status !== 'active') return { promoted: false, reason: 'unavailable' };
  await finishExpiredWaitlists(db, store.line_account_id ?? undefined);
  const next = await db.prepare(`SELECT * FROM rt_seat_waitlist WHERE store_id=? AND julianday(starts_at)=julianday(?) AND status='waiting' ORDER BY created_at,rowid LIMIT 1`).bind(slot.storeId, slot.startsAt).first<SeatWaitlistEntry>();
  if (!next) return { promoted: false, reason: 'empty' };
  const table = await db.prepare('SELECT min_capacity,max_capacity FROM rt_tables WHERE id=? AND store_id=? AND is_active=1').bind(slot.tableId, slot.storeId).first<{ min_capacity: number; max_capacity: number ;}>();
  if (!table || next.guest_count < table.min_capacity || next.guest_count > table.max_capacity) return { promoted: false, reason: 'no_fitting_table' };
  const now = new Date(), holdMinutes = waitlistHoldMinutes(next.starts_at, now), start = Date.parse(next.starts_at);
  const ends = next.ends_at ?? new Date(start + 120 * 60_000).toISOString();
  if (!(await openSeatTables(db,slot.storeId,next.starts_at,ends,next.guest_count,true)).some(t=>t.id===slot.tableId)) return {promoted:false,reason:'unavailable'};
  let result;
  try { result = await db.prepare(`UPDATE rt_seat_waitlist SET status='invited',hold_minutes=?,invited_at=?,hold_expires_at=?,table_id=?,ends_at=?,notification_retry_key=?,updated_at=? WHERE id=? AND status='waiting'`).bind(holdMinutes, now.toISOString(), new Date(Math.min(start, now.getTime() + holdMinutes * 60_000)).toISOString(), slot.tableId, ends, crypto.randomUUID(), now.toISOString(), next.id).run(); } catch(error) { if(String(error).includes('closure_conflict')) return {promoted:false,reason:'unavailable'}; throw error; }
  if (!result.meta.changes) return { promoted: false, reason: 'hold_active' };
  const entry = (await db.prepare('SELECT * FROM rt_seat_waitlist WHERE id=?').bind(next.id).first<SeatWaitlistEntry>())!;
  if (env) await dispatchWaitlistInvites(env, store.line_account_id ?? undefined, liffBaseUrl);
  return { promoted: true, entry };
}
