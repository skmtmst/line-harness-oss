/*
 * N-067: 手動リマインダ登録の二重作成を防ぐ。
 *
 * 実SQLite（better-sqlite3 + bootstrap.sql）に実物の reminders ルートを
 * 当て、認証も実物（Bearer APIキー→staff→権限・account境界）で通す。
 * LINE・外部への送信はしない（登録口は外部を呼ばない）。
 *
 * 対照（キーなし）: 同じ登録を2回送ると201＋201で reminders が2行に
 * なる。これが直す前の振る舞い。キーなし互換として残す。
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

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
      }) as unknown as D1PreparedStatement;
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
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

const TENANT = 'tenant-1';
const ACC_A = 'acc-a';
const ACC_B = 'acc-b';
const KEY_OWNER = 'key-owner-aaa';
const KEY_A = 'key-staff-a';
const KEY_B = 'key-staff-b';

function seed(sqlite: Database.Database) {
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  for (const id of [ACC_A, ACC_B]) {
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 'tenant-1')`,
    ).run(id, `channel-${id}`, id);
  }
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', ?, 'tenant-1', 'all')`,
  ).run(KEY_OWNER);
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('staff-a', '担当A', 'admin', ?, 'tenant-1', 'accounts')`,
  ).run(KEY_A);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('staff-a', ?, '2026-09-01T00:00:00.000Z')`,
  ).run(ACC_A);
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('staff-b', '担当B', 'admin', ?, 'tenant-1', 'accounts')`,
  ).run(KEY_B);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('staff-b', ?, '2026-09-01T00:00:00.000Z')`,
  ).run(ACC_B);
}

let sqlite: Database.Database;
let db: D1Database;
let remindersRoute: Awaited<typeof import('./reminders.js')>['reminders'];

function app() {
  const instance = new Hono<Env>();
  // 認証は実物。Bearer APIキー→staff解決→権限・account境界まで本番通り。
  instance.use('*', authMiddleware);
  instance.route('/', remindersRoute);
  return instance;
}

function post(body: unknown, apiKey: string, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
  const env = { DB: db } as unknown as Env['Bindings'];
  return app().request('/api/reminders', { method: 'POST', headers, body: JSON.stringify(body) }, env);
}

function reminderBody(accountId: string, name: string) {
  return { name, lineAccountId: accountId, triggerType: 'manual' };
}

function reminderCount(): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM reminders`).get() as { n: number }).n;
}

const UUID1 = '11111111-2222-4333-8444-555555555555';
const UUID2 = '22222222-2222-4333-8444-555555555555';
const UUID3 = '33333333-2222-4333-8444-555555555555';
const UUID4 = '44444444-2222-4333-8444-555555555555';
const UUID5 = '55555555-2222-4333-8444-555555555555';
const UUID6 = '66666666-2222-4333-8444-555555555555';

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  seed(sqlite);
  db = asD1(sqlite);
  ({ reminders: remindersRoute } = await import('./reminders.js'));
});

describe('手動登録の二重作成(N-067)', () => {
  test('対照: キーなしで同じ登録を2回送ると201＋201で2行になる', async () => {
    const body = reminderBody(ACC_A, '対照の会');
    const first = await post(body, KEY_OWNER);
    expect(first.status).toBe(201);
    const second = await post(body, KEY_OWNER);
    expect(second.status).toBe(201);
    const a = (await first.json()) as { data: { id: string } };
    const b = (await second.json()) as { data: { id: string } };
    expect(a.data.id).not.toBe(b.data.id);
    expect(reminderCount()).toBe(2);
  });

  test('同一key＋同一内容の再送は同じID・同じ応答で1行だけ', async () => {
    const body = reminderBody(ACC_A, '手動の会');
    const first = await post(body, KEY_OWNER, UUID1);
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { data: { id: string; name: string; createdAt: string } };
    const retry = await post(body, KEY_OWNER, UUID1);
    expect(retry.status).toBe(201);
    const retryJson = (await retry.json()) as { data: { id: string; name: string; createdAt: string } };
    expect(retryJson.data).toEqual(firstJson.data);
    expect(reminderCount()).toBe(1);
    const reservation = sqlite.prepare(
      `SELECT status, response_id FROM outbound_send_requests WHERE idempotency_key = ?`,
    ).get(`reminder:${ACC_A}:${UUID1}`) as { status: string; response_id: string };
    expect(reservation.status).toBe('succeeded');
    expect(reservation.response_id).toBe(firstJson.data.id);
  });

  test('同一key＋別内容は409で、行は1行のまま', async () => {
    const first = await post(reminderBody(ACC_A, '最初の会'), KEY_OWNER, UUID2);
    expect(first.status).toBe(201);
    const second = await post(reminderBody(ACC_A, '変えた会'), KEY_OWNER, UUID2);
    expect(second.status).toBe(409);
    expect(reminderCount()).toBe(1);
  });

  test('同一keyでも別accountは分離して2行作れる', async () => {
    const a = await post(reminderBody(ACC_A, 'A店の会'), KEY_A, UUID3);
    expect(a.status).toBe(201);
    const b = await post(reminderBody(ACC_B, 'B店の会'), KEY_B, UUID3);
    expect(b.status).toBe(201);
    const aJson = (await a.json()) as { data: { id: string } };
    const bJson = (await b.json()) as { data: { id: string } };
    expect(aJson.data.id).not.toBe(bJson.data.id);
    expect(reminderCount()).toBe(2);
  });

  test('担当外accountは403で、行も予約も残らない', async () => {
    const res = await post(reminderBody(ACC_B, '他店の会'), KEY_A, UUID4);
    expect(res.status).toBe(403);
    expect(reminderCount()).toBe(0);
    const n = (sqlite.prepare(`SELECT COUNT(*) AS n FROM outbound_send_requests`).get() as { n: number }).n;
    expect(n).toBe(0);
  });

  test('予約後・登録前に落ちた後の再送は、同じIDで作り直して回収する', async () => {
    const first = await post(reminderBody(ACC_A, '不明後の会'), KEY_OWNER, UUID5);
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { data: { id: string } };
    // 登録と予約確定の間で落ちた想定：登録行だけ消し、予約を未確定へ戻す。
    sqlite.prepare(`DELETE FROM reminders WHERE id = ?`).run(firstJson.data.id);
    sqlite.prepare(
      `UPDATE outbound_send_requests
          SET status = 'in_progress', response_id = NULL, completed_at = NULL
        WHERE idempotency_key = ?`,
    ).run(`reminder:${ACC_A}:${UUID5}`);
    const retry = await post(reminderBody(ACC_A, '不明後の会'), KEY_OWNER, UUID5);
    expect(retry.status).toBe(201);
    const retryJson = (await retry.json()) as { data: { id: string } };
    expect(retryJson.data.id).toBe(firstJson.data.id);
    expect(reminderCount()).toBe(1);
    const row = sqlite.prepare(
      `SELECT status, response_id FROM outbound_send_requests WHERE idempotency_key = ?`,
    ).get(`reminder:${ACC_A}:${UUID5}`) as { status: string; response_id: string };
    expect(row.status).toBe('succeeded');
    expect(row.response_id).toBe(firstJson.data.id);
  });

  test('入力不備は予約を残さず、直した再送は同じkeyで作れる', async () => {
    const bad = await post({ lineAccountId: ACC_A }, KEY_OWNER, UUID6);
    expect(bad.status).toBe(400);
    const n = (sqlite.prepare(`SELECT COUNT(*) AS n FROM outbound_send_requests`).get() as { n: number }).n;
    expect(n).toBe(0);
    const good = await post(reminderBody(ACC_A, '直した会'), KEY_OWNER, UUID6);
    expect(good.status).toBe(201);
    expect(reminderCount()).toBe(1);
  });

  test('同時の二重押下でも1行に収まり、両方とも同じIDを返す', async () => {
    const body = reminderBody(ACC_A, '同時の会');
    const key = '77777777-2222-4333-8444-555555555555';
    const [a, b] = await Promise.all([post(body, KEY_OWNER, key), post(body, KEY_OWNER, key)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aJson = (await a.json()) as { data: { id: string } };
    const bJson = (await b.json()) as { data: { id: string } };
    expect(aJson.data.id).toBe(bJson.data.id);
    expect(reminderCount()).toBe(1);
  });

  test('鍵なし・鍵違いの利用者は401・403で止まる（実auth）', async () => {
    const env = { DB: db } as unknown as Env['Bindings'];
    const noAuth = await app().request('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reminderBody(ACC_A, '権限なし')),
    }, env);
    expect(noAuth.status).toBe(401);
    expect(reminderCount()).toBe(0);
  });
});
