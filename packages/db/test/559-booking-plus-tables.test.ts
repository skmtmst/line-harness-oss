/**
 * 559: 予約の追加機能の表（キャンセル待ち・来店の印・仮押さえ分数）。
 *
 * - booking_waitlist: 同じ枠に同じ人は二度並べない（待っている・仮押さえ中だけ）。
 *   取り消し・予約済みの後は並び直せる。
 * - booking_visit_marks: 「遅れる」のときだけ遅れ分数が必須。それ以外では付けない。
 * - booking_settings.waitlist_hold_minutes: 既定30。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '559_booking_plus_repeat_waitlist_visit.sql'),
  'utf8',
);

describe('migration 559 予約の追加機能の表', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE staff (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
      CREATE TABLE menus (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
      CREATE TABLE booking_customers (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
      CREATE TABLE bookings (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
      CREATE TABLE booking_settings (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE rt_stores (id TEXT PRIMARY KEY);
      CREATE TABLE rt_tables (id TEXT PRIMARY KEY);
      CREATE TABLE rt_reservations (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id, name, created_at) VALUES ('account-a', '本店', '2026-10-04');
      INSERT INTO staff (id, line_account_id) VALUES ('staff-a', 'account-a');
      INSERT INTO menus (id, line_account_id) VALUES ('menu-a', 'account-a');
      INSERT INTO friends (id, line_account_id) VALUES ('friend-a', 'account-a');
      INSERT INTO bookings (id, line_account_id) VALUES ('booking-a', 'account-a');
      INSERT INTO booking_settings (id, line_account_id) VALUES ('settings-a', 'account-a');
    `);
    sqlite.exec(migration);
  });

  afterEach(() => sqlite.close());

  it('同じ枠への二重登録を止め、取り消し後は並び直せる', () => {
    const insert = sqlite.prepare(`
      INSERT INTO booking_waitlist
        (id, line_account_id, staff_id, menu_id, starts_at, friend_id, identity_key)
      VALUES (?, 'account-a', 'staff-a', 'menu-a', '2026-10-10T05:00:00.000Z', 'friend-a', 'friend:friend-a')`);
    insert.run('wait-a');
    // 待っている間の二重登録は止める。
    expect(() => insert.run('wait-b')).toThrow();
    // 本人が取り消した後は同じ枠に並び直せる。
    sqlite.prepare(`UPDATE booking_waitlist SET status = 'cancelled' WHERE id = 'wait-a'`).run();
    insert.run('wait-c');
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM booking_waitlist`).get(),
    ).toMatchObject({ n: 2 });
  });

  it('「遅れる」のときだけ遅れ分数が必須', () => {
    const insert = sqlite.prepare(`
      INSERT INTO booking_visit_marks
        (id, booking_id, line_account_id, kind, late_minutes, marked_by_staff_id, marked_at)
      VALUES (?, 'booking-a', 'account-a', ?, ?, 'staff-a', '2026-10-04T01:00:00.000Z')`);
    // 遅れるのに分数が無いのは止める。
    expect(() => insert.run('mark-a', 'late', null)).toThrow();
    // 来店したのに分数があるのは止める。
    expect(() => insert.run('mark-b', 'visited', 10)).toThrow();
    insert.run('mark-c', 'late', 15);
    insert.run('mark-d', 'visited', null);
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM booking_visit_marks`).get(),
    ).toMatchObject({ n: 2 });
  });

  it('仮押さえ分数の既定は30', () => {
    expect(
      sqlite.prepare(`SELECT waitlist_hold_minutes FROM booking_settings`).get(),
    ).toMatchObject({ waitlist_hold_minutes: 30 });
  });
});
