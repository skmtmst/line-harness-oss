import { describe, expect, it } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite';
import { getBookingAdminDetail, getBookingCustomerContext } from './booking-admin-detail';

describe('予約の顧客カルテ・通知実績', () => {
  it('同じアカウント・同じ顧客の履歴と前回申し送りだけを返す', async () => {
    const testDb = createTestD1();
    testDb.raw.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', '', '');
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-1', 'account-1', '担当', '担当');
      INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price)
      VALUES ('menu-1', 'account-1', '相談', 60, 0, 5000);
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, created_at, updated_at)
      VALUES ('friend-1', 'U1', '山田', 'account-1', '2026-01-01', '2026-01-01');
      INSERT INTO bookings (
        id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
        block_ends_at, status, customer_note, internal_note, price_at_booking,
        requested_at, decided_at, source
      ) VALUES
      ('booking-old', 'account-1', 'friend-1', 'staff-1', 'menu-1',
       '2026-08-01T01:00:00.000Z', '2026-08-01T02:00:00.000Z', '2026-08-01T02:00:00.000Z',
       'completed', '短めに', '足を触る前に声をかける', 5000, '2026-07-31T01:00:00.000Z', '2026-07-31T02:00:00.000Z', 'liff'),
      ('booking-1', 'account-1', 'friend-1', 'staff-1', 'menu-1',
       '2026-09-08T01:00:00.000Z', '2026-09-08T02:00:00.000Z', '2026-09-08T02:00:00.000Z',
       'confirmed', NULL, NULL, 5000, '2026-09-07T01:00:00.000Z', '2026-09-07T02:00:00.000Z', 'operator');
      INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at)
      VALUES ('reminder-1', 'booking-1', 'day_before', '2026-09-07T01:00:00.000Z');
      INSERT INTO booking_operation_runs (
        id, booking_id, line_account_id, kind, status, idempotency_key
      ) VALUES ('run-1', 'booking-1', 'account-1', 'confirmation_line', 'queued', 'booking-1:line');
    `);
    const context = await getBookingCustomerContext(testDb.db, {
      lineAccountId: 'account-1', friendId: 'friend-1',
    });
    expect(context).toMatchObject({
      displayName: '山田',
      previousHandover: '足を触る前に声をかける',
      recentBookings: [expect.objectContaining({ id: 'booking-1' }), expect.objectContaining({ id: 'booking-old' })],
    });
    const detail = await getBookingAdminDetail(testDb.db, {
      id: 'booking-1', lineAccountId: 'account-1',
    });
    expect(detail).toMatchObject({
      previousHandover: '足を触る前に声をかける',
      history: [expect.objectContaining({ id: 'booking-old' })],
      reminders: [expect.objectContaining({ id: 'reminder-1', status: 'pending' })],
      operations: [expect.objectContaining({ id: 'run-1', status: 'queued' })],
    });
  });
});
