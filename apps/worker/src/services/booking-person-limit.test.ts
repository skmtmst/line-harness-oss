import { afterEach, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { BOOKING_PERSON_LIMIT_GUARD_SQL, bookingPersonLimitBindings, bookingPersonLimitError } from './booking-person-limit.js';
const f = createTestD1();
afterEach(() => f.raw.close());
test('同じ人の最後の1枠は同時に別の担当へ予約しても1件だけ取れる（実SQL）', async () => {
  f.raw.exec(`INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','U','a');
    INSERT INTO booking_customers(id,line_account_id,display_name,phone_normalized_hash,phone_encrypted,phone_last4,friend_id)
      VALUES ('phone','a','名前','hash','cipher','1234','f');
    INSERT INTO booking_settings(id,line_account_id,max_active_bookings_per_friend) VALUES ('settings','a',1);`);
  const insert = (id: string, friendId: string | null, customerId: string | null) => f.db.prepare(`
    INSERT INTO bookings(id,line_account_id,friend_id,booking_customer_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
    SELECT ?,'a',?,?,'s','m','2099-01-01T01:00:00Z','2099-01-01T02:00:00Z','2099-01-01T02:00:00Z','confirmed',0,'2026-10-09' WHERE 1=1 ${BOOKING_PERSON_LIMIT_GUARD_SQL}`)
    .bind(id,friendId,customerId,...bookingPersonLimitBindings('a',friendId,customerId)).run();
  const results = await Promise.all([insert('one','f',null),insert('two','f','phone')]);
  expect(results.map(r => r.meta.changes)).toEqual([1,0]);
  expect(await bookingPersonLimitError(f.db,'a','f',null)).toMatchObject({ error:'booking_limit_reached' });
  f.raw.exec("UPDATE bookings SET status='completed'");
  expect(await bookingPersonLimitError(f.db,'a','f',null)).toBeNull();
  expect((await insert('three','f','phone')).meta.changes).toBe(1);
  expect(await bookingPersonLimitError(f.db,'a','f',null)).toMatchObject({ error:'booking_limit_reached' });
});
