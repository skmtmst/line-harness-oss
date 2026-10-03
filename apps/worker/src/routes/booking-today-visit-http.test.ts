/**
 * booking-plus 6: 今日の予約を1画面で。
 *
 * 実 Worker + 実 D1（better-sqlite3 に bootstrap.sql を流したもの）で検証する。
 *
 * - その日の予約が時刻順に返る（翌日の分は入らない）。
 * - 「来店した」→完了、「遅れる」→分数だけ残して状態そのまま、
 *   「来なかった」→無断。だれがいつ付けたかが残る。
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
    c.set('staff', { id: 'owner-1', name: '店長', role: 'owner', readOnly: false, permissionKeys: [], viewPermissionKeys: [] });
    return next();
  });
  app.route('/', route);
  const env = { DB: db } as Env['Bindings'];
  return { app, env };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

let sqlite: Database.Database;
let db: D1Database;
let bookingRoute: Hono<Env>;

function seedBooking(id: string, startsAt: string, status: string) {
  sqlite.prepare(`INSERT INTO bookings
    (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at, block_ends_at,
     status, price_at_booking, requested_at)
    VALUES (?, 'account-a', 'friend-a', 'staff-a', 'menu-a', ?, ?, ?, ?, 5000, '2026-11-01T00:00:00.000Z')`)
    .run(id, startsAt, startsAt, startsAt, status);
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  sqlite.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('account-a','channel-a','A店','token','secret')`).run();
  sqlite.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, display_name)
    VALUES ('friend-a', 'U-a', 'account-a', '花子')`).run();
  sqlite.prepare(`INSERT INTO staff (id, line_account_id, name, display_name, is_active)
    VALUES ('staff-a', 'account-a', '太郎', '太郎', 1)`).run();
  sqlite.prepare(`INSERT INTO menus
    (id, line_account_id, name, duration_minutes, base_price, is_active)
    VALUES ('menu-a', 'account-a', 'カット', 60, 5000, 1)`).run();
  db = asD1(sqlite);
  ({ default: bookingRoute } = await import('./booking.js'));
  access.canAccessAllLineAccounts.mockClear();
});

describe('今日の予約', () => {
  test('その日の予約が時刻順に返る（翌日の分は入らない）', async () => {
    seedBooking('booking-1', '2026-11-10T01:00:00.000Z', 'confirmed');
    seedBooking('booking-2', '2026-11-10T00:00:00.000Z', 'confirmed');
    seedBooking('booking-3', '2026-11-10T16:00:00.000Z', 'confirmed');
    const { app, env } = makeApp(db, bookingRoute);
    const res = await app.request('/api/booking/admin/today?account_id=account-a&date=2026-11-10', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      date: string;
      bookings: Array<{ id: string; starts_at: string; customer_name: string; visit_mark: null }>;
    };
    expect(body.date).toBe('2026-11-10');
    // 00:00Z と 01:00Z は JST 同日の 09:00・10:00。16:00Z は JST 翌日 01:00 で入らない。
    expect(body.bookings.map((booking) => booking.id)).toEqual(['booking-2', 'booking-1']);
    expect(body.bookings[0]).toMatchObject({ customer_name: '花子', visit_mark: null });
  });

  test('「来店した」で完了になり、だれがいつ付けたかが残る', async () => {
    seedBooking('booking-1', '2026-11-10T00:00:00.000Z', 'confirmed');
    const { app, env } = makeApp(db, bookingRoute);
    const marked = await app.request('/api/booking/admin/bookings/booking-1/visit?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ kind: 'visited' }),
    }, env);
    expect(marked.status).toBe(200);
    const markedBody = await marked.json() as {
      status: string;
      visit_mark: { kind: string; marked_by_name: string; marked_at: string };
    };
    expect(markedBody.status).toBe('completed');
    expect(markedBody.visit_mark).toMatchObject({ kind: 'visited', marked_by_name: '店長' });
    expect(markedBody.visit_mark.marked_at).toBeTruthy();

    const today = await app.request('/api/booking/admin/today?account_id=account-a&date=2026-11-10', {}, env);
    const todayBody = await today.json() as {
      bookings: Array<{ id: string; status: string; visit_mark: { kind: string } | null }>;
    };
    expect(todayBody.bookings[0]).toMatchObject({ status: 'completed' });
    expect(todayBody.bookings[0]?.visit_mark).toMatchObject({ kind: 'visited' });
  });

  test('「遅れる」は分数だけ残して状態はそのまま', async () => {
    seedBooking('booking-1', '2026-11-10T00:00:00.000Z', 'confirmed');
    const { app, env } = makeApp(db, bookingRoute);
    const marked = await app.request('/api/booking/admin/bookings/booking-1/visit?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ kind: 'late', late_minutes: 15 }),
    }, env);
    expect(marked.status).toBe(200);
    const body = await marked.json() as {
      status: string; visit_mark: { kind: string; late_minutes: number };
    };
    expect(body.status).toBe('confirmed');
    expect(body.visit_mark).toMatchObject({ kind: 'late', late_minutes: 15 });

    // 分数が無ければ400。
    const missing = await app.request('/api/booking/admin/bookings/booking-1/visit?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ kind: 'late' }),
    }, env);
    expect(missing.status).toBe(400);
  });

  test('「来なかった」で無断になる', async () => {
    seedBooking('booking-1', '2026-11-10T00:00:00.000Z', 'confirmed');
    const { app, env } = makeApp(db, bookingRoute);
    const marked = await app.request('/api/booking/admin/bookings/booking-1/visit?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ kind: 'no_show' }),
    }, env);
    expect(marked.status).toBe(200);
    expect(await marked.json()).toMatchObject({ status: 'no_show' });
  });

  test('印を取り消すと確定へ戻り、印が消える', async () => {
    seedBooking('booking-1', '2026-11-10T00:00:00.000Z', 'confirmed');
    const { app, env } = makeApp(db, bookingRoute);
    await app.request('/api/booking/admin/bookings/booking-1/visit?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ kind: 'visited' }),
    }, env);
    const undone = await app.request('/api/booking/admin/bookings/booking-1/visit?account_id=account-a', {
      method: 'DELETE',
    }, env);
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({ status: 'confirmed' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM booking_visit_marks`).get())
      .toMatchObject({ n: 0 });
    // 印が無ければ404。
    const again = await app.request('/api/booking/admin/bookings/booking-1/visit?account_id=account-a', {
      method: 'DELETE',
    }, env);
    expect(again.status).toBe(404);
  });

  test('終わった予約には付けられない・日付が変なら400', async () => {
    seedBooking('booking-1', '2026-11-10T00:00:00.000Z', 'cancelled');
    const { app, env } = makeApp(db, bookingRoute);
    const closed = await app.request('/api/booking/admin/bookings/booking-1/visit?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ kind: 'late', late_minutes: 10 }),
    }, env);
    expect(closed.status).toBe(409);
    const badDate = await app.request('/api/booking/admin/today?account_id=account-a&date=あした', {}, env);
    expect(badDate.status).toBe(400);
  });
});
