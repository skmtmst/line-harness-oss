import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';

/**
 * R525: 「すぐに計測を始める」をオフで登録したら、最初のINSERTから
 * 停止（is_active=0）で作る。追加情報の保存に失敗しても稼働では残らず、
 * 紹介クリックも受け付けない。
 *
 * 実 Worker（`apps/worker/src/routes/affiliates.ts` をそのまま mount）＋
 * 実 D1（better-sqlite3 に bootstrap.sql）で確かめる。
 */

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

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ACCOUNT_A = 'account-a';

function makeApp(db: D1Database, affiliatesRoute: Awaited<typeof import('./affiliates.js')>['affiliates']) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: 'env-owner', role: 'owner', readOnly: false, tenantId: TENANT_ID });
    return next();
  });
  app.route('/', affiliatesRoute);
  const env = { DB: db, WORKER_URL: 'https://worker.example.com' } as unknown as Env['Bindings'];
  return { app, env };
}

let sqlite: Database.Database;
let db: D1Database;
let affiliatesRoute: Awaited<typeof import('./affiliates.js')>['affiliates'];

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run(ACCOUNT_A, 'channel-a', '本店', TENANT_ID);
  db = asD1(sqlite);
  ({ affiliates: affiliatesRoute } = await import('./affiliates.js'));
});

describe('POST /api/affiliates — 計測オフの登録は停止で作る（R525）', () => {
  test('isActive:false なら最初の行から is_active=0 で作る（自動コード口）', async () => {
    const { app, env } = makeApp(db, affiliatesRoute);
    const res = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '停止で作る紹介者', lineAccountId: ACCOUNT_A, isActive: false, operationId: 'r525-off-0001' }),
    }, env);
    expect(res.status).toBe(201);
    const json = await res.json() as { data: { id: string; isActive: boolean } };
    expect(json.data.isActive).toBe(false);
    const row = sqlite.prepare(`SELECT is_active FROM affiliates WHERE id = ?`).get(json.data.id) as { is_active: number };
    expect(row.is_active).toBe(0);
  });

  test('isActive:false なら最初の行から is_active=0 で作る（明示コード口）', async () => {
    const { app, env } = makeApp(db, affiliatesRoute);
    const res = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '停止で作る紹介者', code: 'R525OFF1', lineAccountId: ACCOUNT_A, isActive: false, operationId: 'r525-off-0002' }),
    }, env);
    expect(res.status).toBe(201);
    const json = await res.json() as { data: { id: string; isActive: boolean } };
    expect(json.data.isActive).toBe(false);
    const row = sqlite.prepare(`SELECT is_active FROM affiliates WHERE id = ?`).get(json.data.id) as { is_active: number };
    expect(row.is_active).toBe(0);
  });

  test('isActive 省略時は従来どおり稼働で作る', async () => {
    const { app, env } = makeApp(db, affiliatesRoute);
    const res = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '稼働で作る紹介者', lineAccountId: ACCOUNT_A, operationId: 'r525-on-0001' }),
    }, env);
    expect(res.status).toBe(201);
    const json = await res.json() as { data: { id: string; isActive: boolean } };
    expect(json.data.isActive).toBe(true);
    const row = sqlite.prepare(`SELECT is_active FROM affiliates WHERE id = ?`).get(json.data.id) as { is_active: number };
    expect(row.is_active).toBe(1);
  });

  test('応答消失後の再送（同じ操作UUID）は停止のまま同じ行を返し二重作成しない', async () => {
    const { app, env } = makeApp(db, affiliatesRoute);
    const body = { name: '再送する紹介者', lineAccountId: ACCOUNT_A, isActive: false, operationId: 'r525-retry-0001' };
    const first = await app.request('/api/affiliates', { method: 'POST', body: JSON.stringify(body) }, env);
    expect(first.status).toBe(201);
    const firstJson = await first.json() as { data: { id: string } };
    const retry = await app.request('/api/affiliates', { method: 'POST', body: JSON.stringify(body) }, env);
    expect(retry.status).toBe(201);
    const retryJson = await retry.json() as { data: { id: string; isActive: boolean } };
    expect(retryJson.data.id).toBe(firstJson.data.id);
    expect(retryJson.data.isActive).toBe(false);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliates WHERE operation_id = 'r525-retry-0001'`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  test('停止で作った紹介者のコードでは紹介クリックを受け付けない', async () => {
    const { app, env } = makeApp(db, affiliatesRoute);
    const created = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '止まっている紹介者', code: 'R525STOP', lineAccountId: ACCOUNT_A, isActive: false, operationId: 'r525-click-0001' }),
    }, env);
    expect(created.status).toBe(201);
    const click = await app.request('/api/affiliates/click', {
      method: 'POST',
      body: JSON.stringify({ code: 'R525STOP' }),
    }, env);
    expect(click.status).toBe(404);
    const clicks = sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliate_clicks`).get() as { n: number };
    expect(clicks.n).toBe(0);
  });
});
