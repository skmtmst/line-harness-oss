/**
 * 席の空き待ちの繰り上げ。
 *
 * - 空いた卓に入る組の早い順に1組だけ招く。入らない組は飛ばす。
 * - 仮押さえ中は招かない。期限切れは列の後ろへ回す。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promoteSeatWaitlist } from './restaurant-seat-waitlist.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations', '559_booking_plus_repeat_waitlist_visit.sql'),
  'utf8',
);

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (sql: string, params: unknown[]) => ({
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} }),
    run: async <T>() => {
      const info = sqlite.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: info.changes } } as T;
    },
    raw: async () => [],
  });
  return {
    prepare: (sql: string) => {
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        ...wrap(sql, params),
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return results as T;
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;
const sender = vi.fn();

const SLOT = '2026-10-10T05:00:00.000Z';
const LIFF_BASE = 'https://liff.line.me/test123';

function addWait(id: string, guests: number, lineUid: string, createdAt: string) {
  sqlite.prepare(`INSERT INTO rt_seat_waitlist
    (id, store_id, starts_at, guest_count, customer_name, line_uid, identity_key, created_at)
    VALUES (?, 'store-a', ?, ?, ?, ?, ?, ?)`)
    .run(id, SLOT, guests, `組-${id}`, lineUid, `line:${lineUid}`, createdAt);
}

function promote(tableId: string) {
  return promoteSeatWaitlist(
    db, { storeId: 'store-a', startsAt: SLOT, tableId }, sender, LIFF_BASE);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL,
      channel_access_token TEXT, channel_access_token_encrypted TEXT);
    CREATE TABLE staff (id TEXT PRIMARY KEY);
    CREATE TABLE menus (id TEXT PRIMARY KEY);
    CREATE TABLE friends (id TEXT PRIMARY KEY);
    CREATE TABLE booking_customers (id TEXT PRIMARY KEY);
    CREATE TABLE bookings (id TEXT PRIMARY KEY);
    CREATE TABLE rt_organizations (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE rt_stores (id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL, line_account_id TEXT, timezone TEXT);
    CREATE TABLE rt_tables (id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      label TEXT NOT NULL, min_capacity INTEGER NOT NULL, max_capacity INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE rt_menu_items (id TEXT PRIMARY KEY);
    CREATE TABLE rt_reservations (id TEXT PRIMARY KEY, store_id TEXT NOT NULL);
    CREATE TABLE booking_settings (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL UNIQUE);
    INSERT INTO line_accounts (id, name, channel_access_token)
      VALUES ('account-a', 'S店', 'token');
    INSERT INTO rt_organizations (id, account_id) VALUES ('org-a', 'account-a');
    INSERT INTO rt_stores (id, organization_id, line_account_id, timezone)
      VALUES ('store-a', 'org-a', 'account-a', 'Asia/Tokyo');
    INSERT INTO rt_tables (id, store_id, label, min_capacity, max_capacity, is_active)
      VALUES ('table-1', 'store-a', 'テーブル1', 1, 2, 1),
             ('table-2', 'store-a', 'テーブル2', 2, 6, 1);
    INSERT INTO booking_settings (id, line_account_id) VALUES ('settings-a', 'account-a');
  `);
  sqlite.exec(migration);
  db = asD1(sqlite);
  sender.mockClear();
});

describe('席の空き待ちの繰り上げ', () => {
  it('入る組の早い順に1組だけ招き、入らない組は飛ばす', async () => {
    addWait('wait-big', 6, 'U-big', '2026-09-01T01:00:00.000Z');
    addWait('wait-fit', 2, 'U-fit', '2026-09-02T01:00:00.000Z');
    const result = await promote('table-1');
    expect(result.promoted).toBe(true);
    if (result.promoted) {
      expect(result.entry.id).toBe('wait-fit');
      expect(result.entry.table_id).toBe('table-1');
    }
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[0]).toMatchObject({ toLineUserId: 'U-fit' });
    expect(sqlite.prepare(`SELECT status FROM rt_seat_waitlist WHERE id = 'wait-big'`).get())
      .toMatchObject({ status: 'waiting' });
  });

  it('仮押さえ中は招かず、期限切れは列の後ろへ回す', async () => {
    addWait('wait-1', 2, 'U-1', '2026-09-01T01:00:00.000Z');
    addWait('wait-2', 2, 'U-2', '2026-09-02T01:00:00.000Z');
    await promote('table-1');
    const held = await promote('table-1');
    expect(held).toMatchObject({ promoted: false, reason: 'hold_active' });
    expect(sender).toHaveBeenCalledTimes(1);
    sqlite.prepare(`UPDATE rt_seat_waitlist SET hold_expires_at = '2020-01-01T00:00:00.000Z'
      WHERE id = 'wait-1'`).run();
    const result = await promote('table-1');
    expect(result.promoted).toBe(true);
    if (result.promoted) expect(result.entry.id).toBe('wait-2');
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('止めている卓には招かない', async () => {
    addWait('wait-1', 2, 'U-1', '2026-09-01T01:00:00.000Z');
    sqlite.prepare(`UPDATE rt_tables SET is_active = 0 WHERE id = 'table-1'`).run();
    const result = await promote('table-1');
    expect(result).toMatchObject({ promoted: false, reason: 'no_fitting_table' });
    expect(sender).not.toHaveBeenCalled();
  });
});
