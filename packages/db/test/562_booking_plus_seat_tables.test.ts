/**
 * 562: 席の空き待ちと席の来店の印の表。
 *
 * - rt_seat_waitlist: 同じ店・同じ開始時刻に同じ組は二度並べない
 *   （待っている・仮押さえ中だけ）。取り消し後は並び直せる。
 * - rt_seat_visit_marks: 「遅れる」のときだけ遅れ分数が必須。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '562_booking_plus_seat_waitlist_visit.sql'),
  'utf8',
);

describe('migration 562 席の空き待ちと来店の印の表', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE rt_organizations (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
      CREATE TABLE rt_stores (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE
      );
      CREATE TABLE rt_tables (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE
      );
      CREATE TABLE rt_reservations (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE
      );
      INSERT INTO rt_organizations (id, account_id) VALUES ('org-a', 'account-a');
      INSERT INTO rt_stores (id, organization_id) VALUES ('store-a', 'org-a');
      INSERT INTO rt_tables (id, store_id) VALUES ('table-a', 'store-a');
      INSERT INTO rt_reservations (id, store_id) VALUES ('reservation-a', 'store-a');
    `);
    sqlite.exec(migration);
  });

  afterEach(() => sqlite.close());

  it('同じ開始時刻への二重登録を止め、取り消し後は並び直せる', () => {
    const insert = sqlite.prepare(`
      INSERT INTO rt_seat_waitlist
        (id, store_id, starts_at, guest_count, customer_name, line_uid, identity_key)
      VALUES (?, 'store-a', '2026-10-10T09:00:00.000Z', 4, '山本', NULL, 'line:U-a')`);
    insert.run('seat-wait-a');
    // 待っている間の二重登録は止める。
    expect(() => insert.run('seat-wait-b')).toThrow();
    // 本人が取り消した後は同じ時刻に並び直せる。
    sqlite.prepare(`UPDATE rt_seat_waitlist SET status = 'cancelled' WHERE id = 'seat-wait-a'`).run();
    insert.run('seat-wait-c');
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM rt_seat_waitlist`).get(),
    ).toMatchObject({ n: 2 });
  });

  it('「遅れる」のときだけ遅れ分数が必須', () => {
    const insert = sqlite.prepare(`
      INSERT INTO rt_seat_visit_marks
        (id, reservation_id, store_id, kind, late_minutes, marked_by_name, marked_at)
      VALUES (?, 'reservation-a', 'store-a', ?, ?, '店長', '2026-10-04T01:00:00.000Z')`);
    // 遅れるのに分数が無いのは止める。
    expect(() => insert.run('mark-a', 'late', null)).toThrow();
    // 来店したのに分数があるのは止める。
    expect(() => insert.run('mark-b', 'visited', 10)).toThrow();
    insert.run('mark-c', 'late', 15);
    insert.run('mark-d', 'visited', null);
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM rt_seat_visit_marks`).get(),
    ).toMatchObject({ n: 2 });
  });
});
