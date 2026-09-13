import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getBookingResourceBackfillStats,
  updateBookingResourceSafely,
} from '../src/booking-resources.js';
import { asD1 } from './d1-test-helper.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '392_booking_resource_consumptions.sql'),
  'utf8',
);

describe('migration 392 予約資源snapshot', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE menus (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
      CREATE TABLE booking_resources (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
        name TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT '2029-01-01',
        updated_at TEXT NOT NULL DEFAULT '2029-01-01'
      );
      CREATE TABLE booking_menu_resources (
        menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL REFERENCES booking_resources(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
        created_at TEXT NOT NULL DEFAULT '2029-01-01',
        PRIMARY KEY (menu_id, resource_id)
      );
      CREATE INDEX idx_booking_menu_resources_resource
        ON booking_menu_resources(resource_id, menu_id);
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
        menu_id TEXT NOT NULL REFERENCES menus(id),
        starts_at TEXT NOT NULL,
        block_ends_at TEXT NOT NULL,
        status TEXT NOT NULL
      );
      INSERT INTO line_accounts VALUES ('account-a'), ('account-b');
      INSERT INTO menus VALUES ('menu-a', 'account-a'), ('menu-b', 'account-b');
      INSERT INTO booking_resources
        (id, line_account_id, name, resource_type, capacity)
      VALUES
        ('room-a', 'account-a', '部屋A', 'room', 5),
        ('room-b', 'account-b', '部屋B', 'room', 5);
      INSERT INTO booking_menu_resources (menu_id, resource_id, quantity)
      VALUES ('menu-a', 'room-a', 2);
      INSERT INTO bookings VALUES
        ('booking-1', 'account-a', 'menu-a', '2030-01-01T01:00:00Z', '2030-01-01T02:00:00Z', 'confirmed'),
        ('booking-2', 'account-a', 'menu-a', '2030-01-01T01:30:00Z', '2030-01-01T02:30:00Z', 'requested');
    `);
    sqlite.exec(migration);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('導入前予約を現行割当と明示して補完し、件数をaccount別に確認できる', async () => {
    expect(sqlite.prepare(`SELECT booking_id, line_account_id, resource_id, quantity, snapshot_source
      FROM booking_resource_consumptions ORDER BY booking_id`).all()).toEqual([
      {
        booking_id: 'booking-1', line_account_id: 'account-a', resource_id: 'room-a',
        quantity: 2, snapshot_source: 'migration_current_assignment',
      },
      {
        booking_id: 'booking-2', line_account_id: 'account-a', resource_id: 'room-a',
        quantity: 2, snapshot_source: 'migration_current_assignment',
      },
    ]);
    await expect(getBookingResourceBackfillStats(db, 'account-a')).resolves.toEqual({
      bookingCount: 2,
      consumptionCount: 2,
    });
    await expect(getBookingResourceBackfillStats(db, 'account-b')).resolves.toEqual({
      bookingCount: 0,
      consumptionCount: 0,
    });
  });

  it('snapshotは割当変更後も不変で、別account挿入・更新・物理削除を拒否する', () => {
    sqlite.prepare(`UPDATE booking_menu_resources SET quantity = 1 WHERE menu_id = 'menu-a'`).run();
    expect(sqlite.prepare(`SELECT quantity FROM booking_resource_consumptions
      WHERE booking_id = 'booking-1'`).get()).toEqual({ quantity: 2 });
    expect(() => sqlite.prepare(`INSERT INTO booking_resource_consumptions
      (booking_id, line_account_id, resource_id, quantity, snapshot_source)
      VALUES ('booking-1', 'account-a', 'room-b', 1, 'booking')`).run())
      .toThrow(/account_mismatch/);
    expect(() => sqlite.prepare(`UPDATE booking_resource_consumptions SET quantity = 1
      WHERE booking_id = 'booking-1'`).run()).toThrow(/immutable/);
    expect(() => sqlite.prepare(`DELETE FROM booking_resources WHERE id = 'room-a'`).run())
      .toThrow(/FOREIGN KEY/);
    sqlite.prepare(`DELETE FROM booking_menu_resources WHERE menu_id = 'menu-a'`).run();
    expect(() => sqlite.prepare(`DELETE FROM booking_resources WHERE id = 'room-a'`).run())
      .toThrow(/FOREIGN KEY/);
  });

  it('将来の最大同時消費より小さい縮小だけ409相当で拒否し、取消後と停止は通す', async () => {
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', capacity: 3, isActive: true,
      now: new Date('2029-12-31T00:00:00Z'),
    })).resolves.toEqual({ status: 'capacity_conflict', peakQuantity: 4 });
    expect(sqlite.prepare(`SELECT capacity FROM booking_resources WHERE id = 'room-a'`).get())
      .toEqual({ capacity: 5 });

    sqlite.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = 'booking-2'`).run();
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', capacity: 2, isActive: true,
      now: new Date('2029-12-31T00:00:00Z'),
    })).resolves.toEqual({ status: 'updated' });
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', capacity: 1, isActive: false,
      now: new Date('2029-12-31T00:00:00Z'),
    })).resolves.toEqual({ status: 'updated' });
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-b', resourceId: 'room-a', capacity: 1, isActive: false,
    })).resolves.toEqual({ status: 'not_found' });
  });
});
