// 空き枠と本人の有効予約数を分け、検証で個別の SELECT を差し替えられる形に保つ。

import {
  ACTIVE_BOOKING_STATUSES,
  type EventBookingStatus,
} from './event-booking-types.js';

export interface SlotWithRemaining {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  active_count: number;
  remaining: number | null;
}

export interface SlotQueryOptions {
  only_future?: boolean;
  only_active?: boolean;
}

interface SlotRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
}

interface BookingCountRow {
  slot_id: string;
  active_count: number;
}

export async function getSlotsWithRemaining(
  db: D1Database,
  event_id: string,
  options: SlotQueryOptions = {},
): Promise<SlotWithRemaining[]> {
  const conditions: string[] = ['event_id = ?', 'deleted_at IS NULL'];
  const params: unknown[] = [event_id];
  if (options.only_active) {
    conditions.push('is_active = 1');
  }
  if (options.only_future) {
    conditions.push("starts_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  }
  const slotsResult = await db
    .prepare(
      `SELECT id, event_id, starts_at, ends_at, capacity, is_active, sort_order
         FROM event_slots
        WHERE ${conditions.join(' AND ')}
        ORDER BY sort_order ASC, starts_at ASC`,
    )
    .bind(...params)
    .all<SlotRow>();
  const slots = slotsResult.results ?? [];
  if (slots.length === 0) return [];

  const counts = await getActiveBookingCountsBySlot(
    db,
    slots.map((s) => s.id),
  );

  return slots.map((s) => {
    const active_count = counts.get(s.id) ?? 0;
    return {
      ...s,
      active_count,
      remaining: s.capacity == null ? null : Math.max(0, s.capacity - active_count),
    };
  });
}

export async function getActiveBookingCountsBySlot(
  db: D1Database,
  slot_ids: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (slot_ids.length === 0) return result;
  const statusList = ACTIVE_BOOKING_STATUSES;
  // slot IDを2回bindするので、D1の100 bind上限を超えない32件ずつに分ける。
  for (let offset = 0; offset < slot_ids.length; offset += 32) {
    const chunk = slot_ids.slice(offset, offset + 32);
    const slotPlaceholders = chunk.map(() => '?').join(',');
    const statusPlaceholders = statusList.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT slot_id, COALESCE(SUM(seats), 0) AS active_count
           FROM (
             SELECT slot_id, party_size AS seats
               FROM event_bookings
              WHERE slot_id IN (${slotPlaceholders})
                AND status IN (${statusPlaceholders})
             UNION ALL
             SELECT slot_id, party_size AS seats
               FROM event_waitlist
              WHERE slot_id IN (${slotPlaceholders})
                AND status IN ('offered', 'accepted')
           )
          GROUP BY slot_id`,
      )
      .bind(...chunk, ...statusList, ...chunk)
      .all<BookingCountRow>();
    for (const r of rows.results ?? []) {
      result.set(r.slot_id, r.active_count);
    }
  }
  return result;
}

export async function getFriendActiveBookingCount(
  db: D1Database,
  event_id: string,
  friend_id: string,
): Promise<number> {
  const placeholders = ACTIVE_BOOKING_STATUSES.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
         FROM event_bookings
        WHERE event_id = ? AND friend_id = ? AND status IN (${placeholders})`,
    )
    .bind(event_id, friend_id, ...ACTIVE_BOOKING_STATUSES)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// 問い合わせ側も同じ有効状態の集合を使えるよう公開する。
export { ACTIVE_BOOKING_STATUSES };
export type { EventBookingStatus };
