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

function makeApp(db: D1Database, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role, readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } };
}

const ALL_TRUE = {
  excludeCalendarBlock: true,
  writeBackToCalendar: true,
  autoAssign: true,
  mergeDuplicates: true,
  conflictNotify: true,
  unconnectedNotify: true,
  dailyLimitNotify: false,
};

describe('F-25 人の予約の自動で合わせるルール', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-a', 'channel-a', '本店', 'token-a', 'secret-a');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  test('無ければ既定を返す（自動割当だけオフ＝今の動き）', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/auto-rules?account_id=account-a', {}, env);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: {
        excludeCalendarBlock: true,
        writeBackToCalendar: true,
        autoAssign: false,
        mergeDuplicates: true,
        conflictNotify: true,
        unconnectedNotify: true,
        dailyLimitNotify: false,
      },
    });
  });

  test('7項目をまとめて保存して読み直せる', async () => {
    const { app, env } = makeApp(db);
    const put = await app.request('/api/booking/admin/auto-rules?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ALL_TRUE),
    }, env);
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toEqual({ success: true, data: ALL_TRUE });
    const get = await app.request('/api/booking/admin/auto-rules?account_id=account-a', {}, env);
    await expect(get.json()).resolves.toEqual({ success: true, data: ALL_TRUE });
  });

  test('既存の自動割当だけオンの状態を引き継ぐ', async () => {
    sqlite.exec(`INSERT INTO account_settings (id, line_account_id, key, value)
      VALUES ('legacy-1', 'account-a', 'booking_auto_assign', 'true')`);
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/auto-rules?account_id=account-a', {}, env);
    await expect(res.json()).resolves.toMatchObject({ success: true, data: { autoAssign: true } });
  });

  test('真偽値でない項目があると400', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/auto-rules?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ALL_TRUE, conflictNotify: 'yes' }),
    }, env);
    expect(res.status).toBe(400);
  });

  test('account_id が無いと400', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/auto-rules', {}, env);
    expect(res.status).toBe(400);
  });
});
