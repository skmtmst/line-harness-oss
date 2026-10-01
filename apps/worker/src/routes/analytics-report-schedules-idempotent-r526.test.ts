import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';

/**
 * R526: 定期レポート作成の応答消失後に再試行しても、有効な予約は1件。
 *
 * 作成に要求キー（`Idempotency-Key`）を付け、同じキー＋同じ内容なら
 * 既にある予約を返す。実 Worker（`apps/worker/src/routes/analytics.ts` を
 * そのまま mount）＋実 D1（better-sqlite3 に bootstrap.sql）で確かめる。
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
const KEY = '11111111-1111-4111-8111-111111111111';

const BODY = {
  name: '週次まとめ',
  sections: ['friends'],
  savedAnalysisIds: [],
  cadence: 'weekly',
  weekday: 1,
  monthDay: null,
  sendTime: '09:00',
  timeZone: 'Asia/Tokyo',
  periodDays: 7,
  recipients: [{ kind: 'email', email: 'report@example.com', label: 'report@example.com' }],
  channels: ['dashboard'],
  alertRules: [],
};

function makeApp(db: D1Database, analyticsRoute: Awaited<typeof import('./analytics.js')>['analytics']) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: 'env-owner', role: 'owner', readOnly: false, tenantId: TENANT_ID });
    return next();
  });
  app.route('/', analyticsRoute);
  const env = { DB: db } as unknown as Env['Bindings'];
  return { app, env };
}

let sqlite: Database.Database;
let db: D1Database;
let analyticsRoute: Awaited<typeof import('./analytics.js')>['analytics'];

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id, timezone)
     VALUES (?, ?, ?, 'token', 'secret', ?, 'Asia/Tokyo')`,
  ).run(ACCOUNT_A, 'channel-a', '本店', TENANT_ID);
  db = asD1(sqlite);
  ({ analytics: analyticsRoute } = await import('./analytics.js'));
});

function post(app: Hono<Env>, env: Env['Bindings'], body: unknown, key?: string) {
  return app.request(`/api/analytics/report-schedules?account_id=${ACCOUNT_A}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  }, env);
}

function activeCount() {
  return (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM analytics_report_schedules WHERE line_account_id = ? AND status = 'active'`,
  ).get(ACCOUNT_A) as { n: number }).n;
}

describe('POST /api/analytics/report-schedules — 要求キーで二重予約にしない（R526）', () => {
  test('応答消失後の再送（同じキー・同じ内容）は同じ予約を返し1件のまま', async () => {
    const { app, env } = makeApp(db, analyticsRoute);
    const first = await post(app, env, BODY, KEY);
    expect(first.status).toBe(201);
    const firstJson = await first.json() as { data: { id: string } };
    expect(firstJson.data.id).toBe(KEY);

    // 応答だけ失われた想定で、同じキー・同じ内容のまま再送する。
    const retry = await post(app, env, BODY, KEY);
    expect(retry.status).toBe(200);
    const retryJson = await retry.json() as { data: { id: string }; replayed?: boolean };
    expect(retryJson.data.id).toBe(firstJson.data.id);
    expect(retryJson.replayed).toBe(true);
    expect(activeCount()).toBe(1);
  });

  test('同じキーの同時2実行でも予約は1件に収まる', async () => {
    const { app, env } = makeApp(db, analyticsRoute);
    const [first, second] = await Promise.all([post(app, env, BODY, KEY), post(app, env, BODY, KEY)]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const firstJson = await first.json() as { data: { id: string } };
    const secondJson = await second.json() as { data: { id: string } };
    expect(secondJson.data.id).toBe(firstJson.data.id);
    expect(activeCount()).toBe(1);
  });

  test('同じキーで内容が違う再送は409で止め2件目を作らない', async () => {
    const { app, env } = makeApp(db, analyticsRoute);
    const first = await post(app, env, BODY, KEY);
    expect(first.status).toBe(201);
    const changed = { ...BODY, name: '変えた週次まとめ' };
    const retry = await post(app, env, changed, KEY);
    expect(retry.status).toBe(409);
    const retryJson = await retry.json() as { data?: { existingId?: string } };
    expect(retryJson.data?.existingId).toBe(KEY);
    expect(activeCount()).toBe(1);
  });

  test('キーになっていない値は400で止める', async () => {
    const { app, env } = makeApp(db, analyticsRoute);
    const res = await post(app, env, BODY, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(activeCount()).toBe(0);
  });

  test('【対比】キーが無い従来の呼び出しは再送で2件できる', async () => {
    const { app, env } = makeApp(db, analyticsRoute);
    expect((await post(app, env, BODY)).status).toBe(201);
    expect((await post(app, env, BODY)).status).toBe(201);
    expect(activeCount()).toBe(2);
  });
});
