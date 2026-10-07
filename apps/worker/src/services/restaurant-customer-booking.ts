import { getBookingAdminSettings } from '@line-crm/db';
import type { Env } from '../index.js';
import type {
  RestaurantCustomerAvailability,
  RestaurantCustomerBooking,
} from '@line-crm/shared';
import { closuresForRange, closureAffectsTable, openSeatTables } from './restaurant-closures.js';
import {
  restaurantCivilTime,
  validRestaurantDate,
} from './restaurant-booking.js';
import { tzDateStr } from './availability.js';
import { sendAutomaticBookingLine } from './booking-automatic-line.js';
export type CustomerReservationRow = {
  id: string;
  store_id: string;
  starts_at: string;
  ends_at: string;
  guest_count: number;
  status: string;
  customer_version: number;
  hold_expires_at: string | null;
  table_id: string | null;
  line_uid: string;
  customer_request_id: string | null;
  note: string | null;
  customer_phone: string | null;
  seat_type: string | null;
};
export function customerBooking(r: CustomerReservationRow): RestaurantCustomerBooking {
  return { id:r.id, storeId:r.store_id, startsAt:r.starts_at, endsAt:r.ends_at, guestCount:r.guest_count,
    status:r.status, version:r.customer_version, holdExpiresAt:r.hold_expires_at,
    note:r.note, customerPhone:r.customer_phone, seatType:r.seat_type };
}
/** 任意欄はUnicodeの文字数で検査。空欄・nullは保存済みの値を消す。 */
export function validCustomerDetails(b: {note?: unknown; customerPhone?: unknown}): boolean {
  return (b.note == null || (typeof b.note === 'string' && Array.from(b.note).length <= 200))
    && (b.customerPhone == null || (typeof b.customerPhone === 'string' && b.customerPhone.length <= 50 && (!b.customerPhone.trim() || /^[+0-9０-９()（）\s-]+$/.test(b.customerPhone))));
}
export const customerDetailValue = (v: string | null | undefined) => v?.trim() || null;
export type CustomerStore = {
  id: string;
  name: string;
  timezone: string;
  line_account_id: string;
  tenant_id: string;
};
export async function customerAvailability(
  db: D1Database,
  store: CustomerStore,
  date: string,
  count: number,
  excludeId?: string,
): Promise<{
  data: RestaurantCustomerAvailability;
  hoursVersion: number;
  holdMinutes: number;
} | null> {
  if (
    !validRestaurantDate(date) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100
  )
    return null;
  const settings = await getBookingAdminSettings(db, store.line_account_id);
  if (!settings) return null;
  const now = Date.now(),
    today = tzDateStr(store.timezone, new Date(now));
  if (
    date < today ||
    Date.parse(date) - Date.parse(today) > settings.bookingWindowDays * 86400000
  )
    return null;
  const hours = await db
    .prepare(
      'SELECT hours_json,version,late_cancel_after_minutes,late_arrival_message FROM rt_opening_hours_settings WHERE store_id=?',
    )
    .bind(store.id)
    .first<{ hours_json: string; version: number; late_cancel_after_minutes: number | null; late_arrival_message: string | null }>();
  if (!hours) return null;
  const parsed = JSON.parse(hours.hours_json) as Array<{
    weekday: number;
    periods: Array<{ opensAt: string; closesAt: string }>;
  }>;
  const minute = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const slots: RestaurantCustomerAvailability['slots'] = [];
  let hasOperatingSlot = false;
  const eligible = (await db.prepare('SELECT id,seat_type FROM rt_tables WHERE store_id=? AND is_active=1 AND min_capacity<=? AND max_capacity>=?').bind(store.id,count,count).all<{id:string;seat_type:string}>()).results;
  const from = restaurantCivilTime(date,0,store.timezone), to = restaurantCivilTime(date,1440,store.timezone);
  const closures = await closuresForRange(db,store.id,from,to);
  const reasonFor = (startsAt:string,endsAt:string): import('@line-crm/shared').RestaurantUnavailableReason => {
    const overlapping = closures.filter(c => (JSON.parse(c.periods_json) as Array<{startsAt:string;endsAt:string}>).some(p => Date.parse(p.startsAt)<Date.parse(endsAt) && Date.parse(p.endsAt)>Date.parse(startsAt)));
    if (overlapping.some(c=>JSON.parse(c.table_ids_json).length===0)
      || (eligible.length && eligible.every(t => overlapping.some(c=>closureAffectsTable(c,t.id))))) {
      return overlapping.some(c=>c.kind==='private_event') ? 'private_event' : 'temporary_closed';
    }
    return 'full';
  };
  // 席の標準滞在時間は既存の席待ちと同じ120分。前日の深夜営業も読む。
  for (const dayOffset of [-1, 0]) {
    const civilDate = new Date(Date.parse(date) + dayOffset * 86400000)
      .toISOString()
      .slice(0, 10);
    for (const period of parsed.find(
      (d) => d.weekday === new Date(civilDate).getUTCDay(),
    )?.periods ?? []) {
      const start = minute(period.opensAt),
        end =
          minute(period.closesAt) +
          (minute(period.closesAt) < start ? 1440 : 0);
      for (
        let m = start;
        m + 120 <= end;
        m += settings.slotGranularityMinutes
      ) {
        const startsAt = restaurantCivilTime(civilDate, m, store.timezone),
          endsAt = new Date(Date.parse(startsAt) + 120 * 60000).toISOString();
        if (tzDateStr(store.timezone,new Date(startsAt)) !== date) continue;
        hasOperatingSlot = true;
        if (Date.parse(startsAt) <= now + settings.cutoffMinutesBefore * 60000) continue;
        let tables = await openSeatTables(
          db,
          store.id,
          startsAt,
          endsAt,
          count,
          !!excludeId,
        );
        if (excludeId) {
          const occupied = (
            await db
              .prepare(
                `SELECT table_id FROM rt_reservations WHERE store_id=? AND id<>? AND status NOT IN ('cancelled','no_show') AND (status<>'pending' OR hold_expires_at IS NULL OR julianday(hold_expires_at)>julianday('now')) AND julianday(starts_at)<julianday(?) AND julianday(ends_at)>julianday(?) UNION SELECT table_id FROM rt_seat_waitlist WHERE store_id=? AND status='invited' AND julianday(hold_expires_at)>julianday('now') AND julianday(starts_at)<julianday(?) AND julianday(ends_at)>julianday(?)`,
              )
              .bind(
                store.id,
                excludeId,
                endsAt,
                startsAt,
                store.id,
                endsAt,
                startsAt,
              )
              .all<{ table_id: string | null }>()
          ).results;
          tables = tables.filter(
            (t) => !occupied.some((r) => r.table_id === t.id),
          );
        }
        const inventories = (
          await db
            .prepare(
              `SELECT i.line_capacity,(SELECT COALESCE(SUM(r.guest_count),0) FROM rt_reservations r WHERE r.store_id=i.store_id AND r.source='line' AND r.id<>? AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR julianday(r.hold_expires_at)>julianday('now')) AND julianday(r.starts_at)<julianday(i.starts_at,'+'||i.slot_minutes||' minutes') AND julianday(r.ends_at)>julianday(i.starts_at)) used FROM rt_inventory_slots i WHERE i.store_id=? AND julianday(i.starts_at)<julianday(?) AND julianday(i.starts_at,'+'||i.slot_minutes||' minutes')>julianday(?)`,
            )
            .bind(excludeId ?? '', store.id, endsAt, startsAt)
            .all<{ line_capacity: number; used: number }>()
        ).results;
        if (inventories.some((i) => i.line_capacity - i.used < count))
          tables = [];
        slots.push({
          startsAt,
          endsAt,
          available: tables.length > 0,
          remainingTables: tables.length,
          seatTypes: [...new Set(tables.map(t=>t.seatType!).filter(Boolean))],
          ...(tables.length ? {} : {unavailableReason:reasonFor(startsAt,endsAt)}),
        });
      }
    }
  }
  return {
    data: {
      storeId: store.id,
      date,
      guestCount: count,
      ...(slots.length === 0 ? {unavailableReason:reasonFor(from,to)==='full' ? (hasOperatingSlot ? 'full' as const : 'regular_closed' as const) : reasonFor(from,to)}
        : slots.every(s=>!s.available) ? {unavailableReason: slots.every(s=>s.unavailableReason===slots[0]!.unavailableReason) ? slots[0]!.unavailableReason : 'full' as const} : {}),
      ...(hours.late_cancel_after_minutes != null && hours.late_arrival_message ? {lateArrivalPolicy:{cancelAfterMinutes:hours.late_cancel_after_minutes,message:hours.late_arrival_message}} : {}),
      slots: slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      cancelDeadlineMinutesBefore: settings.cancelDeadlineMinutesBefore,
      cutoffMinutesBefore: settings.cutoffMinutesBefore,
    },
    hoursVersion: hours.version,
    holdMinutes: settings.holdMinutes,
  };
}
export async function processRestaurantCustomerNotices(
  env: Env['Bindings'],
  storeId?: string,
): Promise<number> {
  const db = env.DB;
  let count = 0;
  const rows = (
    await db
      .prepare(
        `SELECT o.*,s.line_account_id FROM rt_customer_notice_outbox o JOIN rt_stores s ON s.id=o.store_id JOIN rt_reservations r ON r.id=o.reservation_id WHERE o.sent_at IS NULL AND o.customer_version=r.customer_version AND s.status='active' AND (? IS NULL OR s.id=?) AND (o.lease_until IS NULL OR julianday(o.lease_until)<=julianday('now')) LIMIT 50`,
      )
      .bind(storeId ?? null, storeId ?? null)
      .all<{
        id: string;
        line_account_id: string;
        line_uid: string;
        message: string;
        retry_key: string;
      }>()
  ).results;
  for (const r of rows) {
    const lease = crypto.randomUUID();
    const claim = await db
      .prepare(
        "UPDATE rt_customer_notice_outbox SET lease_token=?,lease_until=datetime('now','+5 minutes') WHERE id=? AND sent_at IS NULL AND (lease_until IS NULL OR julianday(lease_until)<=julianday('now'))",
      )
      .bind(lease, r.id)
      .run();
    if (!claim.meta.changes) continue;
    try {
      if (
        await sendAutomaticBookingLine(env, {
          accountId: r.line_account_id,
          to: r.line_uid,
          text: r.message,
          retryKey: r.retry_key,
          featureId: 'restaurant_test',
        })
      ) {
        await db
          .prepare(
            "UPDATE rt_customer_notice_outbox SET sent_at=datetime('now') WHERE id=? AND lease_token=?",
          )
          .bind(r.id, lease)
          .run();
        count++;
      }
    } catch {
      /* 予約を戻さず、同じretry keyで回収 */
    }
  }
  return count;
}
