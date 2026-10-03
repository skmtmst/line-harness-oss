/**
 * booking-plus 2: キャンセル待ちの繰り上げ。
 *
 * - 空いたら登録の早い順に1組だけ招く（カードの LINE は1通）。
 * - 仮押さえ中は次の人を招かない。期限切れは列の後ろへ回す。
 * - 仮押さえ分数は店の設定を使う。
 * - LINE未連携の電話客は送らず invited のまま（店が電話する）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  promoteBookingWaitlist,
  readWaitlistHoldMinutes,
} from './booking-waitlist.js';

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

function addWaitlist(id: string, friendId: string | null, customerId: string | null, createdAt: string) {
  sqlite.prepare(`INSERT INTO booking_waitlist
    (id, line_account_id, staff_id, menu_id, starts_at, friend_id,
     booking_customer_id, identity_key, created_at)
    VALUES (?, 'account-a', 'staff-a', 'menu-a', ?, ?, ?,
      ?, ?)`)
    .run(id, SLOT,
      friendId, customerId,
      friendId ? `friend:${friendId}` : `customer:${customerId}`,
      createdAt);
}

function promote() {
  return promoteBookingWaitlist(
    db, { lineAccountId: 'account-a', staffId: 'staff-a', startsAt: SLOT }, sender, LIFF_BASE);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
      channel_access_token TEXT, channel_access_token_encrypted TEXT, timezone TEXT);
    CREATE TABLE staff (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '担当');
    CREATE TABLE menus (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL, line_user_id TEXT NOT NULL);
    CREATE TABLE booking_customers (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
    CREATE TABLE bookings (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
    CREATE TABLE booking_settings (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL UNIQUE);
    INSERT INTO line_accounts (id, name, created_at, channel_access_token, timezone)
      VALUES ('account-a', '本店', '2026-10-04', 'token', 'Asia/Tokyo');
    INSERT INTO staff (id, line_account_id) VALUES ('staff-a', 'account-a');
    INSERT INTO menus (id, line_account_id, name) VALUES ('menu-a', 'account-a', 'カット');
    INSERT INTO friends (id, line_account_id, line_user_id)
      VALUES ('friend-a', 'account-a', 'U-a'), ('friend-b', 'account-a', 'U-b');
    INSERT INTO booking_customers (id, line_account_id) VALUES ('customer-p', 'account-a');
    INSERT INTO booking_settings (id, line_account_id) VALUES ('settings-a', 'account-a');
  `);
  sqlite.exec(migration);
  db = asD1(sqlite);
  sender.mockClear();
});

describe('キャンセル待ちの繰り上げ', () => {
  it('早い順に1人だけカードで知らせ、店の設定分数で仮押さえする', async () => {
    sqlite.prepare(`UPDATE booking_settings SET waitlist_hold_minutes = 45 WHERE id = 'settings-a'`).run();
    addWaitlist('wait-1', 'friend-a', null, '2026-10-04T01:00:00.000Z');
    addWaitlist('wait-2', 'friend-b', null, '2026-10-04T02:00:00.000Z');
    const result = await promote();
    expect(result.promoted).toBe(true);
    if (result.promoted) {
      expect(result.entry.id).toBe('wait-1');
      expect(result.entry.hold_minutes).toBe(45);
      expect(result.entry.notified_at).not.toBeNull();
    }
    expect(sender).toHaveBeenCalledTimes(1);
    const sent = sender.mock.calls[0]?.[0] as {
      toLineUserId: string; altText: string; bubble: unknown;
    };
    expect(sent.toLineUserId).toBe('U-a');
    const card = JSON.stringify(sent.bubble);
    // 見出し・中身・押し先2つが入っている。
    expect(card).toContain('に空きが出ました');
    expect(card).toContain('この時間で予約する');
    expect(card).toContain('今回は見送る');
    expect(card).toContain(`waitlist=${'wait-1'}`);
    expect(card).toContain(`/booking/waitlist/${'wait-1'}/decline`);
    // 2番目はまだ待っている。
    expect(sqlite.prepare(`SELECT status FROM booking_waitlist WHERE id = 'wait-2'`).get())
      .toMatchObject({ status: 'waiting' });
  });

  it('仮押さえ中は次の人を招かない', async () => {
    addWaitlist('wait-1', 'friend-a', null, '2026-10-04T01:00:00.000Z');
    addWaitlist('wait-2', 'friend-b', null, '2026-10-04T02:00:00.000Z');
    await promote();
    const second = await promote();
    expect(second).toMatchObject({ promoted: false, reason: 'hold_active' });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('仮押さえの期限切れは列へ戻し、次の人を招く', async () => {
    addWaitlist('wait-1', 'friend-a', null, '2026-09-01T01:00:00.000Z');
    addWaitlist('wait-2', 'friend-b', null, '2026-09-02T01:00:00.000Z');
    await promote();
    sqlite.prepare(`UPDATE booking_waitlist SET hold_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = 'wait-1'`).run();
    const result = await promote();
    expect(result.promoted).toBe(true);
    if (result.promoted) expect(result.entry.id).toBe('wait-2');
    expect(sender).toHaveBeenCalledTimes(2);
    // 期限切れの1番目は列の後ろへ回っている。
    expect(sqlite.prepare(`SELECT status FROM booking_waitlist WHERE id = 'wait-1'`).get())
      .toMatchObject({ status: 'waiting' });
  });

  it('電話客は送らず invited のままにする', async () => {
    addWaitlist('wait-p', null, 'customer-p', '2026-10-04T01:00:00.000Z');
    const result = await promote();
    expect(result.promoted).toBe(true);
    expect(sender).not.toHaveBeenCalled();
    expect(sqlite.prepare(`SELECT status, notified_at FROM booking_waitlist WHERE id = 'wait-p'`).get())
      .toMatchObject({ status: 'invited', notified_at: null });
  });

  it('誰も待っていなければ empty', async () => {
    const result = await promote();
    expect(result).toMatchObject({ promoted: false, reason: 'empty' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('仮押さえ分数の既定は30', async () => {
    await expect(readWaitlistHoldMinutes(db, 'account-a')).resolves.toBe(30);
  });
});
