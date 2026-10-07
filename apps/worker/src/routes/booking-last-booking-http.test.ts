/**
 * 予約の追加機能1：前回と同じで予約。
 *
 * 実 Worker + 実 D1（better-sqlite3 に bootstrap.sql を流したもの）で検証する。
 *
 * - 友だちの最新の予約（取り消し・却下・期限切れを除く）のメニューと担当を返す。
 * - 前回の担当が辞めた・メニューが止まっているときは返さない（available=false）。
 * - 履歴が無ければ available=false。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';

const access = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async (_db: unknown, _staff: unknown, ids: string[]) => (
    ids.every((id) => id === 'account-a')
  )),
}));
vi.mock('../services/account-access.js', () => access);

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

function makeApp(db: D1Database, route: Hono<Env>) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'owner', role: 'owner', readOnly: false, permissionKeys: [], viewPermissionKeys: [] });
    return next();
  });
  app.route('/', route);
  const env = { DB: db } as Env['Bindings'];
  return { app, env };
}

let sqlite: Database.Database;
let db: D1Database;
let bookingRoute: Hono<Env>;

function seedBooking(id: string, startsAt: string, status: string, menuId = 'menu-a', staffId = 'staff-a') {
  sqlite.prepare(`INSERT INTO bookings
    (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at, block_ends_at,
     status, price_at_booking, requested_at)
    VALUES (?, 'account-a', 'friend-a', ?, ?, ?, ?, ?, ?, 5000, '2026-10-01T00:00:00.000Z')`)
    .run(id, staffId, menuId, startsAt, startsAt, startsAt, status);
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  sqlite.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('account-a','channel-a','A店','token','secret')`).run();
  sqlite.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, display_name)
    VALUES ('friend-a', 'U-friend-a', 'account-a', '花子')`).run();
  sqlite.prepare(`INSERT INTO staff (id, line_account_id, name, display_name, is_active)
    VALUES ('staff-a', 'account-a', '太郎', '太郎', 1)`).run();
  sqlite.prepare(`INSERT INTO menus
    (id, line_account_id, name, duration_minutes, base_price, is_active)
    VALUES ('menu-a', 'account-a', 'カット', 60, 5000, 1)`).run();
  db = asD1(sqlite);
  ({ default: bookingRoute } = await import('./booking.js'));
  access.canAccessAllLineAccounts.mockClear();
});

describe('前回と同じで予約', () => {
  test('最新の予約のメニューと担当を返す（取り消しは飛ばす）', async () => {
    seedBooking('booking-old', '2026-10-01T05:00:00.000Z', 'completed');
    seedBooking('booking-new', '2026-10-02T05:00:00.000Z', 'confirmed');
    seedBooking('booking-cancelled', '2026-10-03T05:00:00.000Z', 'cancelled');
    const { app, env } = makeApp(db, bookingRoute);
    const res = await app.request('/api/booking/admin/last-booking?account_id=account-a&friend_id=friend-a', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      available: boolean;
      booking: { id: string; menu: { id: string; name: string }; staff: { id: string } };
    };
    expect(body.available).toBe(true);
    expect(body.booking.id).toBe('booking-new');
    expect(body.booking.menu).toMatchObject({ id: 'menu-a', name: 'カット' });
    expect(body.booking.staff).toMatchObject({ id: 'staff-a' });
  });

  test('メニューが止まっているときは返さない', async () => {
    seedBooking('booking-a', '2026-10-02T05:00:00.000Z', 'completed');
    sqlite.prepare(`UPDATE menus SET is_active = 0 WHERE id = 'menu-a'`).run();
    const { app, env } = makeApp(db, bookingRoute);
    const res = await app.request('/api/booking/admin/last-booking?account_id=account-a&friend_id=friend-a', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ available: false, reason: 'menu_inactive' });
  });

  test('担当が辞めたときは返さない', async () => {
    seedBooking('booking-a', '2026-10-02T05:00:00.000Z', 'completed');
    sqlite.prepare(`UPDATE staff SET is_active = 0 WHERE id = 'staff-a'`).run();
    const { app, env } = makeApp(db, bookingRoute);
    const res = await app.request('/api/booking/admin/last-booking?account_id=account-a&friend_id=friend-a', {}, env);
    expect(await res.json()).toMatchObject({ available: false, reason: 'staff_inactive' });
  });

  test('担当がそのメニューを扱っていないときは返さない', async () => {
    seedBooking('booking-a', '2026-10-02T05:00:00.000Z', 'completed');
    sqlite.prepare(`INSERT INTO staff_menus (staff_id, menu_id, is_offered) VALUES ('staff-a', 'menu-a', 0)`).run();
    const { app, env } = makeApp(db, bookingRoute);
    const res = await app.request('/api/booking/admin/last-booking?account_id=account-a&friend_id=friend-a', {}, env);
    expect(await res.json()).toMatchObject({ available: false, reason: 'not_offered' });
  });

  test('履歴が無ければ no_history', async () => {
    const { app, env } = makeApp(db, bookingRoute);
    const res = await app.request('/api/booking/admin/last-booking?account_id=account-a&friend_id=friend-a', {}, env);
    expect(await res.json()).toMatchObject({ available: false, reason: 'no_history' });
  });

  test('客の指定が無ければ400', async () => {
    const { app, env } = makeApp(db, bookingRoute);
    const res = await app.request('/api/booking/admin/last-booking?account_id=account-a', {}, env);
    expect(res.status).toBe(400);
  });
});
