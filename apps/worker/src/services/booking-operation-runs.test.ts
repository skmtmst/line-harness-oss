import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  finishBookingOperation,
  listBookingOperations,
  queueBookingOperation,
} from './booking-operation-runs';

describe('予約後の処理実績', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
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
        block_ends_at, status, price_at_booking, requested_at
      ) VALUES (
        'booking-1', 'account-1', 'friend-1', 'staff-1', 'menu-1',
        '2026-09-08T01:00:00.000Z', '2026-09-08T02:00:00.000Z',
        '2026-09-08T02:00:00.000Z', 'confirmed', 5000, '2026-09-07T01:00:00.000Z'
      );
    `);
  });

  it('同じ冪等キーは1行だけにし、確定した結果を詳細へ返す', async () => {
    const first = await queueBookingOperation(testDb.db, {
      bookingId: 'booking-1', lineAccountId: 'account-1', kind: 'confirmation_line',
      idempotencyKey: 'booking-1:line',
    });
    const replay = await queueBookingOperation(testDb.db, {
      bookingId: 'booking-1', lineAccountId: 'account-1', kind: 'confirmation_line',
      idempotencyKey: 'booking-1:line',
    });
    expect(replay).toBe(first);
    await finishBookingOperation(testDb.db, {
      id: first, status: 'succeeded', completedAt: '2026-09-07T02:00:00.000Z',
      result: { openTracking: 'inbox' },
    });
    expect(await listBookingOperations(testDb.db, {
      bookingId: 'booking-1', lineAccountId: 'account-1',
    })).toEqual([expect.objectContaining({
      id: first,
      kind: 'confirmation_line',
      status: 'succeeded',
      result: { openTracking: 'inbox' },
    })]);
  });
});
