import type { Env } from '../index.js';
import { restaurantTestEnabled } from '../lib/environment-features.js';
import { dispatchWaitlistInvites, finishExpiredWaitlists, promoteBookingWaitlist } from './booking-waitlist.js';
import { promoteSeatWaitlist } from './restaurant-seat-waitlist.js';
/** 時間切れ・取り消し・変更・卓の追加を同じ判定へ送る。処理時刻で回し順を変える。 */
export async function processBookingWaitlists(env: Env['Bindings'], accountId?: string): Promise<void> {
  const db = env.DB;
  await finishExpiredWaitlists(db, accountId);
  const slots = await db.prepare(`SELECT line_account_id,staff_id,starts_at FROM booking_waitlist WHERE status IN ('waiting','invited') AND (? IS NULL OR line_account_id=?) GROUP BY line_account_id,staff_id,starts_at ORDER BY MIN(COALESCE(last_processed_at,'')),MIN(created_at) LIMIT 100`).bind(accountId ?? null, accountId ?? null).all<{ line_account_id: string; staff_id: string; starts_at: string ;}>();
  for (const slot of slots.results) {
    try { for (let i = 0; i < 100; i++) { const result = await promoteBookingWaitlist(db, { lineAccountId: slot.line_account_id, staffId: slot.staff_id, startsAt: slot.starts_at }, undefined, env.LIFF_URL ?? '', env); if (!result.promoted) break; } } catch { console.error(JSON.stringify({ event: 'booking_waitlist_tick_failed' })); }
    await db.prepare('UPDATE booking_waitlist SET last_processed_at=? WHERE line_account_id=? AND staff_id=? AND starts_at=?').bind(new Date().toISOString(), slot.line_account_id, slot.staff_id, slot.starts_at).run();
  }
  const seats = restaurantTestEnabled(env) ? await db.prepare(`SELECT w.store_id,w.starts_at FROM rt_seat_waitlist w JOIN rt_stores s ON s.id=w.store_id WHERE w.status IN ('waiting','invited') AND (? IS NULL OR s.line_account_id=?) GROUP BY w.store_id,w.starts_at ORDER BY MIN(COALESCE(w.last_processed_at,'')),MIN(w.created_at) LIMIT 100`).bind(accountId ?? null, accountId ?? null).all<{ store_id: string; starts_at: string ;}>() : { results: [] as Array<{ store_id: string; starts_at: string ;}> };
  for (const slot of seats.results) {
    const tables = await db.prepare('SELECT id FROM rt_tables WHERE store_id=? AND is_active=1 ORDER BY max_capacity,id').bind(slot.store_id).all<{ id: string ;}>();
    try { for (let i = 0; i < tables.results.length; i++) { let promoted = false; for (const table of tables.results) { const result = await promoteSeatWaitlist(db, { storeId: slot.store_id, startsAt: slot.starts_at, tableId: table.id }, undefined, env.LIFF_URL ?? '', env); if (result.promoted) { promoted = true; break; } } if (!promoted) break; } } catch { console.error(JSON.stringify({ event: 'seat_waitlist_tick_failed' })); }
    await db.prepare('UPDATE rt_seat_waitlist SET last_processed_at=? WHERE store_id=? AND starts_at=?').bind(new Date().toISOString(), slot.store_id, slot.starts_at).run();
  }
  await dispatchWaitlistInvites(env, accountId);
}
