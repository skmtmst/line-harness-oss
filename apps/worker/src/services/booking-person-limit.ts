/** Append to reservation INSERT so parallel requests cannot pass the limit together. */
const PERSON_BOOKINGS_SQL = `(SELECT COUNT(*) FROM bookings b
  WHERE b.line_account_id = ? AND b.status IN ('requested','confirmed')
    AND julianday(b.ends_at) > julianday('now')
    AND (b.friend_id = ? OR b.booking_customer_id IN (
      SELECT id FROM booking_customers WHERE friend_id = ? AND line_account_id = ?
    ) OR b.booking_customer_id = ?))`;
const PERSON_LIMIT_SQL = `COALESCE((SELECT max_active_bookings_per_friend
  FROM booking_settings WHERE line_account_id = ?), 1)`;
export const BOOKING_PERSON_LIMIT_GUARD_SQL = `AND ${PERSON_BOOKINGS_SQL} < ${PERSON_LIMIT_SQL}`;
export function bookingPersonLimitBindings(accountId: string, friendId: string | null, customerId: string | null): unknown[] {
  return [accountId, friendId, friendId, accountId, customerId, accountId];
}
export async function bookingPersonLimitError(db: D1Database, accountId: string, friendId: string | null, customerId: string | null) {
  const row = await db.prepare(`SELECT ${PERSON_BOOKINGS_SQL} >= ${PERSON_LIMIT_SQL} AS reached`)
    .bind(...bookingPersonLimitBindings(accountId, friendId, customerId)).first<{ reached: number }>();
  return row?.reached ? { error: 'booking_limit_reached', fields: {
    [customerId ? 'booking_customer_id' : 'friend_id']: '同時に持てる予約の上限に達しています。現在の予約を完了または取り消してから予約してください。',
  } } : null;
}
