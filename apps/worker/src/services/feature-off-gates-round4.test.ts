/*
 * #643 再差戻し(4回目)の実行試験。
 *
 * 1. manifest の booking calendar delete retry が機能オフ中に claim も
 *    Google Calendar 削除もせず、skipped 監査だけ残すこと。
 * 2. 再オンでそのまま拾い直せること(状態が壊れていないこと)。
 */
import { describe, expect, it, vi } from 'vitest';
import { FEATURE_IDS } from '@line-crm/shared';
import { saveVersionedAccountSetting } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processPendingCalendarDeleteOperations } from './booking-calendar-sync.js';

const BUNDLE_KEY = 'feature.settings_bundle_v1';
const NOW = new Date('2026-09-09T00:00:00.000Z');

async function disableFeature(db: SqliteD1, accountId: string, feature: string) {
  const features = Object.fromEntries(FEATURE_IDS.map((key) => [key, true]));
  features[feature] = false;
  const result = await saveVersionedAccountSetting(db.db, {
    accountId,
    key: BUNDLE_KEY,
    expectedVersion: 0,
    data: { features },
  });
  expect(result.status).toBe('saved');
}

function seed(db: SqliteD1) {
  db.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-1', 'ch-1', 'A1', 'tok', 'sec'),
           ('account-2', 'ch-2', 'A2', 'tok', 'sec');
    INSERT INTO bookings
      (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at, block_ends_at,
       status, price_at_booking, requested_at, external_event_id)
    VALUES
      ('bk-off', 'account-1', 'fr-1', 'st-1', 'mn-1',
       '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z', '2026-09-20T02:00:00.000Z',
       'cancelled', 1000, '2026-09-01T00:00:00.000Z', 'gcal-off'),
      ('bk-on', 'account-2', 'fr-2', 'st-2', 'mn-2',
       '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z', '2026-09-20T02:00:00.000Z',
       'cancelled', 1000, '2026-09-01T00:00:00.000Z', 'gcal-on');
    INSERT INTO booking_operation_runs
      (id, booking_id, line_account_id, kind, status, opened_at, result_json,
       idempotency_key, created_at, updated_at)
    VALUES
      ('op-off', 'bk-off', 'account-1', 'google_calendar', 'retry_wait', NULL,
       '{"direction":"delete"}', 'bk-off:google-calendar:delete',
       '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000'),
      ('op-on', 'bk-on', 'account-2', 'google_calendar', 'retry_wait', NULL,
       '{"direction":"delete"}', 'bk-on:google-calendar:delete',
       '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000');
  `);
}

function opRow(db: SqliteD1, id: string) {
  return db.raw.prepare(
    'SELECT status, opened_at, completed_at, error_code FROM booking_operation_runs WHERE id = ?',
  ).get(id) as { status: string; opened_at: string | null; completed_at: string | null; error_code: string | null };
}

function skippedAudits(db: SqliteD1) {
  return db.raw.prepare(
    `SELECT line_account_id, target_id, result FROM audit_events
      WHERE action = 'feature.execution.skipped' ORDER BY id`,
  ).all() as Array<{ line_account_id: string; target_id: string; result: string }>;
}

describe('booking calendar delete retry の off gate', () => {
  it('機能オフ中は claim も外部削除もせず、skipped 監査だけ残す', async () => {
    const testDb = createTestD1();
    try {
      seed(testDb);
      await disableFeature(testDb, 'account-1', 'booking');
      const remove = vi.fn(async (_bookingId: string, _lineAccountId: string) => {});

      const result = await processPendingCalendarDeleteOperations(testDb.db, { now: NOW, remove });

      // オフのアカウントの行は1件も触らない。動いている方だけ進む。
      expect(remove.mock.calls.map(([bookingId]) => bookingId)).toEqual(['bk-on']);
      expect(result).toEqual({ processed: 1, succeeded: 1, retrying: 0, skipped: 0 });

      const off = opRow(testDb, 'op-off');
      expect(off.status).toBe('retry_wait');
      expect(off.opened_at).toBeNull();
      expect(off.completed_at).toBeNull();
      expect(off.error_code).toBeNull();
      expect(opRow(testDb, 'op-on').status).toBe('succeeded');

      // 止めた事実は監査に残す。動いている側の監査は作らない。
      expect(skippedAudits(testDb)).toEqual([
        {
          line_account_id: 'account-1',
          target_id: 'booking calendar delete retry',
          result: 'denied',
        },
      ]);
    } finally {
      testDb.raw.close();
    }
  });

  it('再オンでそのまま拾い直し、Google Calendar 削除まで進む', async () => {
    const testDb = createTestD1();
    try {
      seed(testDb);
      await disableFeature(testDb, 'account-1', 'booking');
      const blocked = vi.fn(async (_bookingId: string, _lineAccountId: string) => {});
      await processPendingCalendarDeleteOperations(testDb.db, { now: NOW, remove: blocked });
      expect(blocked.mock.calls.map(([bookingId]) => bookingId)).toEqual(['bk-on']);

      await testDb.db.prepare('DELETE FROM account_settings WHERE line_account_id = ? AND key = ?')
        .bind('account-1', BUNDLE_KEY).run();

      const resumed = vi.fn(async (_bookingId: string, _lineAccountId: string) => {});
      const result = await processPendingCalendarDeleteOperations(testDb.db, {
        now: new Date('2026-09-09T00:05:00.000Z'),
        remove: resumed,
      });
      expect(resumed.mock.calls.map(([bookingId]) => bookingId)).toEqual(['bk-off']);
      expect(result).toEqual({ processed: 1, succeeded: 1, retrying: 0, skipped: 0 });
      expect(opRow(testDb, 'op-off').status).toBe('succeeded');
    } finally {
      testDb.raw.close();
    }
  });

  it('lease中の行はオフ判定に関わらず取らない', async () => {
    const testDb = createTestD1();
    try {
      seed(testDb);
      // 別workerが掴んだばかりの行(lease有効)は候補に入らない。
      testDb.raw.prepare('UPDATE booking_operation_runs SET opened_at = ? WHERE id = ?')
        .run('2026-09-09T00:00:00.000Z', 'op-on');
      const remove = vi.fn(async (_bookingId: string, _lineAccountId: string) => {});
      const result = await processPendingCalendarDeleteOperations(testDb.db, { now: NOW, remove });
      expect(remove.mock.calls.map(([bookingId]) => bookingId)).toEqual(['bk-off']);
      expect(result.processed).toBe(1);
    } finally {
      testDb.raw.close();
    }
  });
});
