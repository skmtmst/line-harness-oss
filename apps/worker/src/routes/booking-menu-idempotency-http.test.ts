/**
 * R535 / R538: 予約メニュー作成の応答再送と担当割当の権限。
 *
 * 実 Worker + 実 D1（better-sqlite3 に bootstrap.sql を流したもの）で検証する。
 * Miniflare はこの環境で listen できないため、affiliate-offers 系と同じ
 * better-sqlite3 方式を使う。
 *
 * - R535: 同じ Idempotency-Key での作成POST再送は作り直さず、
 *   作成済みIDを返す（応答消失後の再操作で2件にならない）。
 * - R535: キーが無ければ従来どおり毎回作成する（後方互換）。
 * - R535: キーが違えば別メニューとして作成する。
 * - R538: 閲覧のみ（viewキー）の staff では担当割当の一括PUTが403。
 *   編集キーでは通る。Worker 側の認可が画面の出し分けの裏付け。
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

interface StaffStub {
  id: string;
  role: 'owner' | 'admin' | 'staff';
  permissionKeys?: string[];
  viewPermissionKeys?: string[];
}

function makeApp(
  db: D1Database,
  route: Hono<Env>,
  stub: StaffStub = { id: 'owner-1', role: 'owner' },
) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: stub.id,
      name: stub.role,
      role: stub.role,
      readOnly: false,
      permissionKeys: stub.permissionKeys ?? [],
      viewPermissionKeys: stub.viewPermissionKeys ?? [],
    });
    return next();
  });
  app.route('/', route);
  const env = { DB: db } as Env['Bindings'];
  return { app, env };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MENU_BODY = { name: 'カット', duration_minutes: 60, base_price: 5000 };

let sqlite: Database.Database;
let db: D1Database;
let bookingRoute: Hono<Env>;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  sqlite.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('account-a','channel-a','A店','token','secret')`).run();
  db = asD1(sqlite);
  ({ default: bookingRoute } = await import('./booking.js'));
  access.canAccessAllLineAccounts.mockClear();
});

async function menuCount(): Promise<number> {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM menus WHERE line_account_id = 'account-a'`).get() as { n: number };
  return row.n;
}

describe('R535 メニュー作成の応答再送は作り直さない', () => {
  test('同じキーでの再送は同じIDを返し、メニューは1件', async () => {
    const { app, env } = makeApp(db, bookingRoute);
    const headers = { ...JSON_HEADERS, 'Idempotency-Key': 'menu-try-1' };
    const first = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST', headers, body: JSON.stringify(MENU_BODY),
    }, env);
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { id: string; version: number };

    // 応答消失後の再送。保存は済んでいるので作り直さない。
    const second = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST', headers, body: JSON.stringify(MENU_BODY),
    }, env);
    expect(second.status).toBe(201);
    const secondBody = await second.json() as { id: string; version: number };
    expect(secondBody.id).toBe(firstBody.id);
    expect(await menuCount()).toBe(1);
  });

  test('キーが無ければ従来どおり毎回作成する', async () => {
    const { app, env } = makeApp(db, bookingRoute);
    for (let i = 0; i < 2; i += 1) {
      const res = await app.request('/api/booking/admin/menus?account_id=account-a', {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(MENU_BODY),
      }, env);
      expect(res.status).toBe(201);
    }
    expect(await menuCount()).toBe(2);
  });

  test('キーが違えば別メニューとして作成する', async () => {
    const { app, env } = makeApp(db, bookingRoute);
    const ids = new Set<string>();
    for (const key of ['menu-try-a', 'menu-try-b']) {
      const res = await app.request('/api/booking/admin/menus?account_id=account-a', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body: JSON.stringify(MENU_BODY),
      }, env);
      expect(res.status).toBe(201);
      ids.add(((await res.json()) as { id: string }).id);
    }
    expect(ids.size).toBe(2);
    expect(await menuCount()).toBe(2);
  });
});

describe('R538 担当割当の一括PUTは閲覧のみを拒否する', () => {
  test('viewキーの staff は403、editキーだけ通る', async () => {
    const viewer = makeApp(db, bookingRoute, { id: 's-view', role: 'staff', viewPermissionKeys: ['/booking/menus'] });
    const denied = await viewer.app.request('/api/booking/admin/staff-menus?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ staff: [] }),
    }, viewer.env);
    expect(denied.status).toBe(403);

    const editor = makeApp(db, bookingRoute, { id: 's-edit', role: 'staff', permissionKeys: ['/booking/menus'] });
    const allowed = await editor.app.request('/api/booking/admin/staff-menus?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ staff: [] }),
    }, editor.env);
    expect(allowed.status).toBe(200);
  });
});
