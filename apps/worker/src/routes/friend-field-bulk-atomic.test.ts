import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendFields } from './friend-fields.js';

const BULK_KEY_VERSION = 'v1';

async function bulkKey(accountId: string, fieldId: string, friendIds: string[], value: unknown): Promise<string> {
  const canonical = [BULK_KEY_VERSION, accountId, fieldId, [...friendIds].sort().join(','), JSON.stringify(value)].join('\n');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `ffbulk_${hex}`;
}

function createApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friendFields);
  return { app, env: { DB: db } as Env['Bindings'] };
}

function seed(testDb: SqliteD1): void {
  const { raw } = testDb;
  raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)').run(DEFAULT_TENANT_ID, '既定統括');
  const insertAccount = raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES (?, ?, ?, 'token', 'secret', 1, ?)
  `);
  insertAccount.run('account-a', 'channel-a', '店舗A', DEFAULT_TENANT_ID);
  insertAccount.run('account-b', 'channel-b', '店舗B', DEFAULT_TENANT_ID);

  const insertStaff = raw.prepare(`
    INSERT INTO staff_members
      (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?)
  `);
  insertStaff.run('owner-all', '既定統括owner', 'owner', 'full', 'key-owner', 'all', DEFAULT_TENANT_ID);
  insertStaff.run('admin-ro', '閲覧管理者', 'admin', 'read_only', 'key-ro', 'all', DEFAULT_TENANT_ID);

  insertFriend(raw, 'f1', { line_account_id: 'account-a' });
  insertFriend(raw, 'f2', { line_account_id: 'account-a' });
  insertFriend(raw, 'f3', { line_account_id: 'account-a' });
  insertFriend(raw, 'g1', { line_account_id: 'account-b' });

  raw.prepare(`INSERT INTO friend_fields (id, name, field_key, type) VALUES ('fld-a', 'メモA', 'memo_a', 'text')`).run();
  raw.prepare(`INSERT INTO friend_field_scopes (field_id, tenant_id, line_account_id, created_at) VALUES ('fld-a', ?, 'account-a', '2026-01-01')`).run(DEFAULT_TENANT_ID);
  raw.prepare(`INSERT INTO friend_fields (id, name, field_key, type) VALUES ('fld-b', 'メモB', 'memo_b', 'text')`).run();
  raw.prepare(`INSERT INTO friend_field_scopes (field_id, tenant_id, line_account_id, created_at) VALUES ('fld-b', ?, 'account-b', '2026-01-01')`).run(DEFAULT_TENANT_ID);
}

describe('N-046 一括更新の原子性と冪等 (#812)', () => {
  let testDb: SqliteD1;
  let target: ReturnType<typeof createApp>;

  beforeEach(() => {
    testDb = createTestD1();
    seed(testDb);
    target = createApp(testDb.db);
  });

  afterEach(() => {
    testDb.raw.close();
  });

  async function postBulk(apiKey: string | undefined, body: unknown, idempotencyKey?: string): Promise<{ status: number; body: any }> {
    const response = await target.app.request('/api/friend-fields/bulk', {
      method: 'POST',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, target.env);
    return { status: response.status, body: await response.json() as any };
  }

  function valuesOf(): Array<{ friend_id: string; value: string | null }> {
    return testDb.raw.prepare('SELECT friend_id, value FROM friend_field_values ORDER BY friend_id').all() as Array<{
      friend_id: string;
      value: string | null;
    }>;
  }

  const baseBody = (overrides: Record<string, unknown> = {}) => ({
    friendIds: ['f1', 'f2', 'f3'],
    fieldId: 'fld-a',
    value: '済',
    lineAccountId: 'account-a',
    ...overrides,
  });

  it('対照: 2件目の書込失敗は500で永続変更0件', async () => {
    let writes = 0;
    const prepare = testDb.db.prepare.bind(testDb.db);
    testDb.db.prepare = ((query: string) => {
      const stmt = prepare(query) as unknown as {
        bind: (...args: unknown[]) => { first: unknown; all: unknown; run: () => Promise<unknown> };
      };
      return {
        bind: (...args: unknown[]) => {
          const bound = stmt.bind(...args);
          return {
            first: bound.first,
            all: bound.all,
            run: async () => {
              if (/^\s*(INSERT|UPDATE|DELETE)/i.test(query) && /friend_field_values/i.test(query) && ++writes === 2) {
                throw new Error('simulated mid-loop DB failure');
              }
              return bound.run();
            },
          };
        },
      };
    }) as D1Database['prepare'];
    target = createApp(testDb.db);

    const response = await postBulk('key-owner', baseBody());
    expect(response.status).toBe(500);
    expect(valuesOf()).toEqual([]);
  });

  it('正常: 3件とも書けて件数を返す', async () => {
    const response = await postBulk('key-owner', baseBody());
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ updated: 3 });
    expect(valuesOf()).toEqual([
      { friend_id: 'f1', value: '済' },
      { friend_id: 'f2', value: '済' },
      { friend_id: 'f3', value: '済' },
    ]);
  });

  it('再送: 同一key同一内容は同じ結果で二重更新しない', async () => {
    const body = baseBody();
    const key = await bulkKey('account-a', 'fld-a', body.friendIds as string[], body.value);
    const first = await postBulk('key-owner', body, key);
    expect(first.status).toBe(200);
    const second = await postBulk('key-owner', body, key);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(valuesOf()).toHaveLength(3);
    expect(valuesOf()).toEqual([
      { friend_id: 'f1', value: '済' },
      { friend_id: 'f2', value: '済' },
      { friend_id: 'f3', value: '済' },
    ]);
  });

  it('同一key別内容は409で書かない', async () => {
    const body = baseBody();
    const key = await bulkKey('account-a', 'fld-a', body.friendIds as string[], body.value);
    const response = await postBulk('key-owner', baseBody({ value: '別' }), key);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(valuesOf()).toEqual([]);
  });

  it('同一key別accountは共有せず409で書かない', async () => {
    const body = baseBody();
    const keyForA = await bulkKey('account-a', 'fld-a', body.friendIds as string[], body.value);
    const cross = await postBulk('key-owner', {
      friendIds: ['g1'],
      fieldId: 'fld-b',
      value: '済',
      lineAccountId: 'account-b',
    }, keyForA);
    expect(cross.status).toBe(409);
    expect(valuesOf()).toEqual([]);

    const keyForB = await bulkKey('account-b', 'fld-b', ['g1'], '済');
    const own = await postBulk('key-owner', {
      friendIds: ['g1'],
      fieldId: 'fld-b',
      value: '済',
      lineAccountId: 'account-b',
    }, keyForB);
    expect(own.status).toBe(200);
    expect(valuesOf()).toEqual([{ friend_id: 'g1', value: '済' }]);
  });

  it('不正なkey形式は400で書かない', async () => {
    const response = await postBulk('key-owner', baseBody(), 'not-a-key');
    expect(response.status).toBe(400);
    expect(valuesOf()).toEqual([]);
  });

  it('keyなしも200（既存互換）', async () => {
    const response = await postBulk('key-owner', baseBody());
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ updated: 3 });
  });

  it('事前検証失敗は書かずに422/404', async () => {
    const badField = await postBulk('key-owner', baseBody({ fieldId: 'fld-missing' }));
    expect(badField.status).toBe(404);
    const badFriend = await postBulk('key-owner', baseBody({ friendIds: ['f1', 'ghost'] }));
    expect(badFriend.status).toBe(404);
    expect(valuesOf()).toEqual([]);
  });

  it('空配列は400、1001件は422', async () => {
    expect((await postBulk('key-owner', baseBody({ friendIds: [] }))).status).toBe(400);
    expect((await postBulk('key-owner', baseBody({ friendIds: Array.from({ length: 1001 }, (_, i) => `f${i}`) }))).status).toBe(422);
    expect(valuesOf()).toEqual([]);
  });

  it('read-onlyは403で書かない', async () => {
    const response = await postBulk('key-ro', baseBody());
    expect(response.status).toBe(403);
    expect(valuesOf()).toEqual([]);
  });
});
