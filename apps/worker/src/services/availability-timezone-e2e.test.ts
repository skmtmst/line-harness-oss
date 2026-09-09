// 直接E2E: 実 SQLite に対する getAvailability（SQL・timezone 取得つき）。
// スタブでは検出できない実 SQL の誤り（プレースホルダ等）を固定する。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { getAvailability } from './availability.js';

function asD1(sqlite: Database.Database): D1Database {
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({ success: true, results: statement.all(...params) as T[], meta: {} }),
        first: async <T>() => (statement.get(...params) as T | undefined) ?? null,
        run: async <T>() => {
          const result = statement.run(...params);
          return { success: true, results: [], meta: { changes: result.changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
  };
  return db as unknown as D1Database;
}

describe('getAvailability の実DB E2E（NY）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-ny', 'channel-ny', 'NY店', 'token-ny', 'secret-ny');
      INSERT INTO booking_settings (id, line_account_id, timezone)
      VALUES ('settings-ny', 'account-ny', 'America/New_York');
      INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price)
      VALUES
        ('menu-ny', 'account-ny', '相談', 60, 8000),
        ('menu-other', 'account-ny', '別施術', 60, 5000);
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-ny', 'account-ny', '担当NY', '担当NY');
      INSERT INTO staff_menus (staff_id, menu_id, is_offered)
      VALUES ('staff-ny', 'menu-ny', 1);
      INSERT INTO friends (id, line_user_id, display_name, line_account_id)
      VALUES ('friend-ny', 'line-friend-ny', '予約者', 'account-ny');
      INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES
        ('shift-ny-1', 'staff-ny', '2026-11-01', '01:00', '03:00'),
        ('shift-ny-2', 'staff-ny', '2026-10-10', '10:00', '12:00');
      INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
         block_ends_at, status, price_at_booking, requested_at)
      VALUES
        ('booking-fold', 'account-ny', 'friend-ny', 'staff-ny', 'menu-other',
         '2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z',
         '2026-11-01T06:30:00.000Z', 'confirmed', 8000,
         '2026-10-01T00:00:00.000Z');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  test('候補は店舗timezone＋offset付きinstantを持つ', async () => {
    const result = await getAvailability(db, {
      lineAccountId: 'account-ny',
      menuId: 'menu-ny',
      from: '2026-10-10',
      to: '2026-10-10',
      now: new Date('2026-10-09T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots[0]).toMatchObject({
      date: '2026-10-10',
      start: '10:00',
      timeZone: 'America/New_York',
      startUtc: '2026-10-10T10:00:00-04:00',
      endUtc: '2026-10-10T11:00:00-04:00',
    });
  });

  test('fold を跨ぐ保存済み予約で 01:00/01:30 が塞がり 02:00 が残る', async () => {
    const result = await getAvailability(db, {
      lineAccountId: 'account-ny',
      menuId: 'menu-ny',
      from: '2026-11-01',
      to: '2026-11-01',
      now: new Date('2026-10-31T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['02:00']);
  });

  test('UTC より遅れた店舗の夜の予約も、既存予約の取得範囲に入る', async () => {
    // NY 10/10 21:00 は 10/11 01:00Z。暦日を UTC の 00:00 と見なして
    // 前後 1 日を足す取り方だと `starts_at < 10/11 00:00Z` に当たらず、
    // 埋まっているのに空き枠として出ていた（#651 の夜間二重予約）。
    sqlite.exec(`
      UPDATE staff_shifts SET start_time = '19:00', end_time = '23:00'
       WHERE id = 'shift-ny-2';
      INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
         block_ends_at, status, price_at_booking, requested_at)
      VALUES
        ('booking-night', 'account-ny', 'friend-ny', 'staff-ny', 'menu-other',
         '2026-10-11T01:00:00.000Z', '2026-10-11T02:00:00.000Z',
         '2026-10-11T02:00:00.000Z', 'confirmed', 5000,
         '2026-10-01T00:00:00.000Z');
    `);
    const result = await getAvailability(db, {
      lineAccountId: 'account-ny',
      menuId: 'menu-ny',
      from: '2026-10-10',
      to: '2026-10-10',
      now: new Date('2026-10-09T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    const starts = result.by_staff[0].slots.map((slot) => slot.start);
    expect(starts).toEqual(['19:00', '19:30', '20:00', '22:00']);
    expect(starts).not.toContain('21:00');
  });

  test('店舗休業の例外日は実DBでも枠を出さない', async () => {
    sqlite.exec(`
      INSERT INTO booking_availability_exceptions
        (id, line_account_id, scope_kind, date_from, date_to, kind, hours_json, reason)
      VALUES ('exc-ny-1', 'account-ny', 'store', '2026-10-10', '2026-10-10', 'closed', '[]', '棚卸');
    `);
    const result = await getAvailability(db, {
      lineAccountId: 'account-ny',
      menuId: 'menu-ny',
      from: '2026-10-10',
      to: '2026-10-10',
      now: new Date('2026-10-09T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots).toEqual([]);
  });
});
