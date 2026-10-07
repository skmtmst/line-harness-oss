import { getBookingAdminSettings } from '@line-crm/db';
import type { Env } from '../index.js';
import type {
  RestaurantCustomerAvailability,
  RestaurantCustomerBooking,
} from '@line-crm/shared';
import { openSeatTables } from './restaurant-closures.js';
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
};
export const customerBooking = (
  r: CustomerReservationRow,
): RestaurantCustomerBooking => ({
  id: r.id,
  storeId: r.store_id,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  guestCount: r.guest_count,
  status: r.status,
  version: r.customer_version,
  holdExpiresAt: r.hold_expires_at,
});
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
      'SELECT hours_json,version FROM rt_opening_hours_settings WHERE store_id=?',
    )
    .bind(store.id)
    .first<{ hours_json: string; version: number }>();
  if (!hours) return null;
  const parsed = JSON.parse(hours.hours_json) as Array<{
    weekday: number;
    periods: Array<{ opensAt: string; closesAt: string }>;
  }>;
  const minute = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const slots: RestaurantCustomerAvailability['slots'] = [];
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
        if (
          tzDateStr(store.timezone, new Date(startsAt)) !== date ||
          Date.parse(startsAt) <= now + settings.cutoffMinutesBefore * 60000
        )
          continue;
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
        });
      }
    }
  }
  return {
    data: {
      storeId: store.id,
      date,
      guestCount: count,
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
