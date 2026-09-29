/*
 * P0-1 統合ユーザーの物理削除ガード。実 SQLite + bootstrap.sql に本物の
 * ルータを通す。DB は本物なので、関連が残る・消えるの両方を見張れる。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: mocks.scope,
}));

const { users } = await import('./users.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = readFileSync(join(HERE, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8');

let sqlite: Database.Database;

/** better-sqlite3 を D1 の口にかぶせる。SQL はそのまま流す。 */
function asD1(): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() { return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} }; },
      async first<T>() { return (sqlite.prepare(query).get(...params) as T | undefined) ?? null; },
      async run() { const info = sqlite.prepare(query).run(...params); return { meta: { changes: info.changes } }; },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

function app(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: asD1() } as never;
    c.set('staff', {
      id: 'staff-1', name: '担当', role, readOnly: false, tenantId: DEFAULT_TENANT_ID,
    } as never);
    return next();
  });
  instance.route('/', users);
  return instance;
}

function seedUser(id: string) {
  sqlite.prepare(
    `INSERT INTO users (id, tenant_id, email, created_at, updated_at)
     VALUES (?, ?, ?, '2026-09-25T10:00:00+09:00', '2026-09-25T10:00:00+09:00')`,
  ).run(id, DEFAULT_TENANT_ID, `${id}@example.com`);
}

function seedFriend(id: string, lineUserId: string, userId: string | null) {
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, user_id, created_at, updated_at)
     VALUES (?, ?, 'account-1', ?, '2026-09-25T10:00:00+09:00', '2026-09-25T10:00:00+09:00')`,
  ).run(id, lineUserId, userId);
}

function row(id: string) {
  return sqlite.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(BOOTSTRAP);
  mocks.scope.mockResolvedValue({
    allowedAccountIds: ['account-1'], canSeeUnassigned: true, isAccountScoped: false,
  });
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'ch-1', 'A', 'tok', 'sec')`,
  ).run();
});

describe('DELETE /api/users/:id の物理削除ガード', () => {
  test('結びついた友だちがいるときは409で、利用者も友だちの結びつきも残す', async () => {
    seedUser('user-1');
    seedFriend('friend-1', 'U00000000000000000000000000000001', 'user-1');

    const res = await app().request('/api/users/user-1', { method: 'DELETE' });
    expect(res.status).toBe(409);

    expect(row('user-1')?.status).toBe('active');
    expect(
      sqlite.prepare(`SELECT user_id FROM friends WHERE id = 'friend-1'`).get(),
    ).toMatchObject({ user_id: 'user-1' });
  });

  test('関連がなければ物理削除せず退避（archive）にし、行は残す', async () => {
    seedUser('user-1');

    const res = await app().request('/api/users/user-1', { method: 'DELETE' });
    expect(res.status).toBe(200);

    const kept = row('user-1');
    expect(kept).toBeDefined();
    expect(kept?.status).toBe('archived');
    expect(kept?.archived_at).toBeTruthy();
  });

  test('退避済みは一覧に出さず、詳細は404にする', async () => {
    seedUser('user-1');
    await app().request('/api/users/user-1', { method: 'DELETE' });

    const list = await app().request('/api/users');
    const listBody = (await list.json()) as { data: Array<{ id: string }> };
    expect(listBody.data.map((item) => item.id)).not.toContain('user-1');

    const detail = await app().request('/api/users/user-1');
    expect(detail.status).toBe(404);
  });

  test('退避済みへの削除のやり直しは成功扱いにする', async () => {
    seedUser('user-1');
    await app().request('/api/users/user-1', { method: 'DELETE' });

    const retry = await app().request('/api/users/user-1', { method: 'DELETE' });
    expect(retry.status).toBe(200);
    expect(row('user-1')?.status).toBe('archived');
  });

  test('owner以外は退避もできない', async () => {
    seedUser('user-1');

    const res = await app('admin').request('/api/users/user-1', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(row('user-1')?.status).toBe('active');
  });
});
