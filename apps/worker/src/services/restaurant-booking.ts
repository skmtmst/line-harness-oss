import type { RestaurantHoldInput } from '@line-crm/shared';

/** 再実行しても二重解除しない。個人情報をログに出さない。 */
export async function expireRestaurantHolds(db: D1Database, now = new Date().toISOString(), storeId?: string, organizationId?: string): Promise<number> {
  const result = await db.prepare(`UPDATE rt_reservations SET status = 'cancelled', updated_at = datetime('now')
    WHERE status = 'pending' AND hold_expires_at IS NOT NULL AND datetime(hold_expires_at) <= datetime(?)
      AND (? IS NULL OR store_id = ?) AND (? IS NULL OR store_id IN (SELECT id FROM rt_stores WHERE organization_id = ?))`)
    .bind(now, storeId ?? null, storeId ?? null, organizationId ?? null, organizationId ?? null).run();
  if (result.meta.changes) await db.prepare(`UPDATE rt_inventory_slots SET reserved_count = COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id = rt_inventory_slots.store_id AND r.status NOT IN ('cancelled', 'no_show') AND datetime(r.starts_at) < datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes') AND datetime(r.ends_at) > datetime(rt_inventory_slots.starts_at)), 0) WHERE (? IS NULL OR store_id = ?) AND (? IS NULL OR store_id IN (SELECT id FROM rt_stores WHERE organization_id = ?))`).bind(storeId ?? null, storeId ?? null, organizationId ?? null, organizationId ?? null).run();
  return result.meta.changes;
}

export function validateRestaurantHold(body: unknown): RestaurantHoldInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.storeId !== 'string' || typeof b.startsAt !== 'string' || typeof b.endsAt !== 'string'
    || !Number.isFinite(Date.parse(b.startsAt)) || !Number.isFinite(Date.parse(b.endsAt))
    || Date.parse(b.endsAt) <= Date.parse(b.startsAt)
    || typeof b.guestCount !== 'number' || !Number.isInteger(b.guestCount) || b.guestCount < 1 || b.guestCount > 100
    || typeof b.holdMinutes !== 'number' || !Number.isInteger(b.holdMinutes) || b.holdMinutes < 1 || b.holdMinutes > 120
    || (b.tableId !== undefined && b.tableId !== null && typeof b.tableId !== 'string')
    || (b.note !== undefined && b.note !== null && (typeof b.note !== 'string' || b.note.length > 1000))) return null;
  return { ...b, startsAt: new Date(b.startsAt).toISOString(), endsAt: new Date(b.endsAt).toISOString() } as RestaurantHoldInput;
}

/** 店舗の暦日を検査。2026-02-30のような繰上がりを許さない。 */
export function validRestaurantDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date;
}
export function restaurantCivilTime(date: string, minute: number, timezone: string): string {
  const civil = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  let utc = civil;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(new Date(utc));
    const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT');
    utc = civil - (offset ? (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000 : 0);
  }
  return new Date(utc).toISOString();
}
