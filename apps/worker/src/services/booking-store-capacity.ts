/** Store seats are shared across staff; salon bookings consume one seat each. */
export interface StoreCapacityWindow {
  start: string;
  end: string;
  capacity: number;
}

export function storeSeatsForSlot(
  windows: StoreCapacityWindow[],
  bookings: Array<{ startMs: number; endMs: number }>,
  startMs: number,
  endMs: number,
): { capacity: number; remaining: number } {
  let capacity = Number.POSITIVE_INFINITY;
  let remaining = Number.POSITIVE_INFINITY;
  for (const window of windows) {
    const start = Math.max(startMs, Date.parse(window.start));
    const end = Math.min(endMs, Date.parse(window.end));
    if (start >= end) continue;
    // Occupancy only increases at a booking start. Count the peak, not all
    // bookings that touch a long candidate but never overlap each other.
    const points = [start, ...bookings.filter(b => start < b.startMs && b.startMs < end).map(b => b.startMs)];
    const used = Math.max(...points.map(point => bookings.filter(b => b.startMs <= point && point < b.endMs).length));
    capacity = Math.min(capacity, window.capacity);
    remaining = Math.min(remaining, window.capacity - used);
  }
  return { capacity, remaining: Math.max(0, remaining) };
}

/** Append to INSERT ... SELECT's WHERE. Bind: clipped windows JSON, account, account.
 * The occupied-seat reads and INSERT must remain ONE statement. The windows
 * contain UTC instants, including timezone/day boundaries and the buffer.
 */
export const STORE_CAPACITY_GUARD_SQL = `AND NOT EXISTS (
  SELECT 1 FROM json_each(?) AS store_window
   WHERE EXISTS (
     SELECT 1 FROM (
       SELECT julianday(json_extract(store_window.value, '$.start')) AS point
       UNION ALL
       SELECT julianday(starts_at) AS point FROM bookings
        WHERE line_account_id = ? AND status IN ('requested','confirmed')
          AND julianday(starts_at) > julianday(json_extract(store_window.value, '$.start'))
          AND julianday(starts_at) < julianday(json_extract(store_window.value, '$.end'))
     ) AS points
     WHERE (
       SELECT COUNT(*) FROM bookings
        WHERE line_account_id = ? AND status IN ('requested','confirmed')
          AND julianday(starts_at) <= points.point
          AND julianday(block_ends_at) > points.point
     ) >= json_extract(store_window.value, '$.capacity')
   )
)`;
