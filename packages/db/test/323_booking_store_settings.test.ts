import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBookingAvailabilityException,
  getBookingAdminSettings,
  listBookingAvailabilityExceptions,
  updateBookingAvailabilityException,
  updateBookingMenuSettings,
} from '../src/booking-settings.js';
import { asD1 } from './d1-test-helper.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '323_booking_store_settings.sql'),
  'utf8',
);
const capacityMigration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '326_booking_capacity_and_menu_resources.sql'),
  'utf8',
);

describe('migration 323 店舗共通の予約設定', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE line_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE staff (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE menus (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        base_price INTEGER NOT NULL,
        booking_window_days INTEGER,
        cutoff_hours_before INTEGER,
        cancel_deadline_hours_before INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO line_accounts (id, name, created_at) VALUES
        ('account-a', '本店', '2026-09-01T00:00:00.000+09:00'),
        ('account-b', '支店', '2026-09-01T00:00:00.000+09:00');
      INSERT INTO staff (id, line_account_id) VALUES
        ('staff-a', 'account-a'), ('staff-b', 'account-b');
      INSERT INTO menus
        (id, line_account_id, name, base_price, booking_window_days,
         cutoff_hours_before, cancel_deadline_hours_before, is_active, created_at, updated_at)
      VALUES
        ('menu-a', 'account-a', '相談', 8000, NULL, 2, NULL, 1, '2026-09-01', '2026-09-01'),
        ('menu-a-stop', 'account-a', '停止中', 0, 30, NULL, NULL, 0, '2026-09-01', '2026-09-01'),
        ('menu-b', 'account-b', '別店舗', 5000, NULL, NULL, NULL, 1, '2026-09-01', '2026-09-01');
    `);
    sqlite.exec(migration);
    sqlite.exec(capacityMigration);
    sqlite.exec(`
      INSERT INTO booking_business_hours
        (id, booking_settings_id, weekday, start_time, end_time)
      VALUES
        ('hours-a-1', 'booking-settings-account-a', 1, '09:00', '12:00'),
        ('hours-a-2', 'booking-settings-account-a', 1, '13:00', '19:00');
      INSERT INTO booking_resources
        (id, line_account_id, name, resource_type, capacity)
      VALUES ('room-a', 'account-a', '相談室', 'room', 2);
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('既存店舗とメニューへ安全な既定値と版を補う', () => {
    expect(sqlite.prepare(`SELECT line_account_id, timezone, booking_window_days,
      cutoff_minutes_before, approval_mode, version FROM booking_settings
      WHERE line_account_id = 'account-a'`).get()).toEqual({
      line_account_id: 'account-a',
      timezone: 'Asia/Tokyo',
      booking_window_days: 60,
      cutoff_minutes_before: 1440,
      approval_mode: 'automatic',
      version: 1,
    });
    expect(sqlite.prepare(`SELECT price_mode, version FROM menus WHERE id = 'menu-a'`).get())
      .toEqual({ price_mode: 'fixed', version: 1 });
    expect(() => sqlite.prepare(`UPDATE menus SET price_mode = 'inquiry' WHERE id = 'menu-a'`).run())
      .toThrow(/CHECK/);
    expect(() => sqlite.prepare(`INSERT INTO booking_business_hours
      (id, booking_settings_id, weekday, start_time, end_time)
      VALUES ('bad-hours', 'booking-settings-account-a', 2, '25:00', '26:00')`).run())
      .toThrow(/CHECK/);
  });

  it('店舗設定は複数営業時間・店舗例外・実メニュー件数を同じアカウントだけ返す', async () => {
    await createBookingAvailabilityException(db, {
      lineAccountId: 'account-a',
      scopeKind: 'store',
      scopeId: null,
      dateFrom: '2026-12-30',
      dateTo: '2026-12-30',
      kind: 'closed',
      intervals: [],
      reason: '年末休業',
    });
    const settings = await getBookingAdminSettings(db, 'account-a');
    expect(settings).toMatchObject({
      lineAccountId: 'account-a',
      organizationName: '本店',
      version: 1,
      menuCount: 2,
      activeMenuCount: 1,
      inactiveMenuCount: 1,
      businessHours: expect.arrayContaining([{
        weekday: 1,
        intervals: [
          { start: '09:00', end: '12:00', capacity: 1 },
          { start: '13:00', end: '19:00', capacity: 1 },
        ],
      }]),
      exceptions: [expect.objectContaining({
        date: '2026-12-30', kind: 'closed', intervals: [], reason: '年末休業',
      })],
    });
    await expect(getBookingAdminSettings(db, 'missing')).resolves.toBeNull();
  });

  it('休業・短縮・臨時営業を対象別に保存し、古い版と別店舗を拒否する', async () => {
    const created = await createBookingAvailabilityException(db, {
      lineAccountId: 'account-a',
      scopeKind: 'staff',
      scopeId: 'staff-a',
      dateFrom: '2026-09-20',
      dateTo: '2026-09-21',
      kind: 'custom_hours',
      intervals: [{ start: '10:00', end: '16:00' }],
      reason: '研修期間',
    });
    expect(created).toMatchObject({ version: 1, scopeKind: 'staff', date: null });
    await expect(createBookingAvailabilityException(db, {
      lineAccountId: 'account-a',
      scopeKind: 'staff',
      scopeId: 'staff-b',
      dateFrom: '2026-09-22',
      dateTo: '2026-09-22',
      kind: 'closed',
      intervals: [],
      reason: null,
    })).resolves.toBeNull();

    const updateInput = {
      id: created!.id,
      lineAccountId: 'account-a',
      expectedVersion: 1,
      scopeKind: 'resource' as const,
      scopeId: 'room-a',
      dateFrom: '2026-09-20',
      dateTo: '2026-09-20',
      kind: 'open' as const,
      intervals: [{ start: '09:00', end: '18:00' }],
      reason: '臨時営業',
    };
    await expect(updateBookingAvailabilityException(db, updateInput)).resolves.toMatchObject({
      status: 'updated', item: { version: 2, scopeKind: 'resource', kind: 'open' },
    });
    await expect(updateBookingAvailabilityException(db, updateInput)).resolves.toEqual({
      status: 'conflict', currentVersion: 2,
    });
    const items = await listBookingAvailabilityExceptions(db, 'account-a');
    expect(items).toHaveLength(1);
    await expect(listBookingAvailabilityExceptions(db, 'account-b')).resolves.toEqual([]);
  });

  it('価格種別と店舗既定の上書きを版付きで更新する', async () => {
    await expect(updateBookingMenuSettings(db, {
      id: 'menu-a',
      lineAccountId: 'account-a',
      expectedVersion: 1,
      priceMode: 'inquiry',
      bookingWindowDays: 45,
      cutoffHoursBefore: null,
      cancelDeadlineHoursBefore: 24,
    })).resolves.toEqual({ status: 'updated', version: 2 });
    expect(sqlite.prepare(`SELECT price_mode, base_price, booking_window_days,
      cutoff_hours_before, cancel_deadline_hours_before, version
      FROM menus WHERE id = 'menu-a'`).get()).toEqual({
      price_mode: 'inquiry',
      base_price: 0,
      booking_window_days: 45,
      cutoff_hours_before: null,
      cancel_deadline_hours_before: 24,
      version: 2,
    });
    await expect(updateBookingMenuSettings(db, {
      id: 'menu-a', lineAccountId: 'account-a', expectedVersion: 1, priceMode: 'free',
    })).resolves.toEqual({ status: 'conflict', currentVersion: 2 });
    await expect(updateBookingMenuSettings(db, {
      id: 'menu-b', lineAccountId: 'account-a', expectedVersion: 1, priceMode: 'free',
    })).resolves.toEqual({ status: 'not_found' });
  });
});
