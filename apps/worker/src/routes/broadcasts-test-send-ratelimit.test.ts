import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';

/**
 * D027: テスト送信の10秒制限を並行リクエストでも守ること。
 *
 * 実 route + 実 DB モジュール + メモリ SQLite。LINE 送信は偽にして
 * push の回数を数える。直列の2回目は従来どおり 429。
 * 並行2件は片方だけが送り、もう片方は 429 になる。
 */

const lineCalls = vi.hoisted(() => ({ push: 0 }));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    async pushMessage() { lineCalls.push++; return { requestId: 'req-1' }; }
    async broadcast() { return { requestId: 'req-1' }; }
    async multicast() { return { requestId: 'req-1' }; }
    async getMessageQuota() { return { value: 10000 }; }
  },
}));

const { broadcasts } = await import('./broadcasts.js');

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
    // 実 D1 と同じく原子に積む。並行テスト送信の再現に使う。
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        try { sqlite.exec('ROLLBACK'); } catch { /* 既に外で閉じた */ }
        throw error;
      }
      return results as T;
    },
  } as unknown as D1Database;
}

const TENANT_ID = '00000000-0000-4000-8000-000000000001';

function seed(sqlite: Database.Database) {
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES ('acc-1', 'channel-acc-1', '本店', 'token', 'secret', ?)`,
  ).run(TENANT_ID);
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, is_following)
     VALUES ('f-1', 'U-f1', 'acc-1', 1)`,
  ).run();
  sqlite.prepare(
    `INSERT INTO account_settings (line_account_id, key, value) VALUES ('acc-1', 'test_recipients', ?)`,
  ).run(JSON.stringify(['f-1']));
  sqlite.prepare(
    `INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id, track_links, scheduled_at)
     VALUES ('bc-1', '予約配信', 'text', 'こんにちは', 'all', 'scheduled', 'acc-1', 0, '2026-12-31T10:00:00+09:00')`,
  ).run();
}

function makeApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: 'env-owner', role: 'owner', readOnly: false, tenantId: TENANT_ID });
    return next();
  });
  app.route('/', broadcasts);
  const env = { DB: db, WORKER_URL: 'https://worker.example.com' } as unknown as Env['Bindings'];
  return { app, env };
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = ON');
  seed(sqlite);
  db = asD1(sqlite);
  lineCalls.push = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

const auditCount = () =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM operation_audit WHERE action = 'test_send'`).get() as { n: number }).n;

const postTestSend = (app: Hono<Env>, env: Env['Bindings']) =>
  app.request('/api/broadcasts/bc-1/test-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, env);

describe('D027 POST /api/broadcasts/:id/test-send の10秒制限', () => {
  test('直列の2回目は 429 で止まり、送るのは1回だけ', async () => {
    const { app, env } = makeApp(db);
    const first = await postTestSend(app, env);
    const second = await postTestSend(app, env);
    expect(first.status).toBeLessThan(300);
    expect(second.status).toBe(429);
    expect(second.headers.get('Retry-After')).toBe('10');
    expect(lineCalls.push).toBe(1);
    expect(auditCount()).toBe(1);
  });

  test('並行2件でも送るのは1回だけ（もう片方は 429）', async () => {
    const { app, env } = makeApp(db);
    const [first, second] = await Promise.all([postTestSend(app, env), postTestSend(app, env)]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses[0]).toBeLessThan(300);
    expect(statuses[1]).toBe(429);
    expect(lineCalls.push).toBe(1);
    expect(auditCount()).toBe(1);
  });
});
