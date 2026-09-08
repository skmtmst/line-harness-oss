// E2E: 競合代替候補の日付・時刻が店舗 timezone で読まれること。
// booking.ts の bookingConflictAlternatives 用。実 DB＋実 getAvailability。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { default: booking } = await import('./booking.js');

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

function makeApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } };
}

describe('競合代替候補のタイムゾーン（E2E）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
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
      VALUES ('menu-ny', 'account-ny', '相談', 60, 8000);
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-ny', 'account-ny', '担当NY', '担当NY');
      INSERT INTO staff_menus (staff_id, menu_id, is_offered)
      VALUES ('staff-ny', 'menu-ny', 1);
      INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES
        ('shift-ny-1', 'staff-ny', '2026-10-10', '10:00', '12:00'),
        ('shift-ny-2', 'staff-ny', '2027-03-14', '03:00', '05:00'),
        ('shift-ny-3', 'staff-ny', '2026-11-01', '01:00', '05:00');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  async function alternatives(startsAt: string) {
    const { app, env } = makeApp(db);
    const res = await app.request(
      `/api/booking/admin/alternatives?account_id=account-ny&menu_id=menu-ny&staff_id=staff-ny&starts_at=${encodeURIComponent(startsAt)}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    return res.json() as Promise<{
      nearbySlots: Array<{ date: string; start: string }>;
    }>;
  }

  test('NY 10:00（14:00Z）の候補は同日 10:30 から並ぶ', async () => {
    const body = await alternatives('2026-10-10T14:00:00.000Z');
    expect(body.nearbySlots.map((s) => `${s.date} ${s.start}`)).toEqual([
      '2026-10-10 10:30',
      '2026-10-10 11:00',
    ]);
  });

  test('NY 前日 23:00（03:00Z）の候補は前日扱いで空になる', async () => {
    const body = await alternatives('2026-10-10T03:00:00.000Z');
    expect(body.nearbySlots).toEqual([]);
  });

  test('NY DST 開始日 03:00（07:00Z）の候補は 03:30 から並ぶ', async () => {
    const body = await alternatives('2027-03-14T07:00:00.000Z');
    expect(body.nearbySlots[0]).toMatchObject({ date: '2027-03-14', start: '03:30' });
  });

  test('NY DST 終了日 02:30（07:30Z）の候補は 02:00 から並ぶ', async () => {
    const body = await alternatives('2026-11-01T07:30:00.000Z');
    expect(body.nearbySlots[0]).toMatchObject({ date: '2026-11-01', start: '02:00' });
  });
});
