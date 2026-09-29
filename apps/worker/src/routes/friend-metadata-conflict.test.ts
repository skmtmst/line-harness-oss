import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friends } from './friends.js';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';

function createApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friends);
  return { app, env: { DB: db } as Env['Bindings'] };
}

function seed(testDb: SqliteD1): void {
  const { raw } = testDb;
  raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)').run(DEFAULT_TENANT_ID, '既定統括');
  raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)').run(OTHER_TENANT_ID, '別統括');
  const insertAccount = raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES (?, ?, ?, 'token', 'secret', 1, ?)
  `);
  insertAccount.run('account-a', 'channel-a', '店舗A', DEFAULT_TENANT_ID);
  insertAccount.run('account-foreign', 'channel-foreign', '別統括店舗', OTHER_TENANT_ID);

  const insertStaff = raw.prepare(`
    INSERT INTO staff_members
      (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?)
  `);
  insertStaff.run('admin-all', '統括管理者', 'admin', 'full', 'key-admin', 'all', DEFAULT_TENANT_ID);
  insertStaff.run('staff-partial', '店舗A担当', 'staff', 'full', 'key-partial', 'accounts', DEFAULT_TENANT_ID);
  raw.prepare(`UPDATE staff_members SET permission_keys = '["/friends"]' WHERE id = 'staff-partial'`).run();
  raw.prepare(`
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES ('staff-partial', 'account-a', '2026-09-09T00:00:00.000Z')
  `).run();

  insertFriend(raw, 'friend-a', { line_account_id: 'account-a', updated_at: '2026-09-14T20:00:00.000+09:00' });
  insertFriend(raw, 'friend-foreign', { line_account_id: 'account-foreign', updated_at: '2026-09-14T20:00:00.000+09:00' });
}

describe('N-040 注目切替の競合検知 (#808)', () => {
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

  async function putMetadata(
    apiKey: string | undefined,
    friendId: string,
    body: unknown,
    expectedUpdatedAt?: string,
  ): Promise<{ status: number; body: any }> {
    const query = expectedUpdatedAt !== undefined ? `?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}` : '';
    const response = await target.app.request(`/api/friends/${friendId}/metadata${query}`, {
      method: 'PUT',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, target.env);
    return { status: response.status, body: await response.json() as any };
  }

  function metadataOf(friendId: string): { metadata: string; updatedAt: string } {
    return testDb.raw.prepare('SELECT metadata, updated_at AS updatedAt FROM friends WHERE id = ?').get(friendId) as {
      metadata: string;
      updatedAt: string;
    };
  }

  it('対照: 同じ旧改訂値からの2回更新は2回目が409で後勝ちしない', async () => {
    const base = metadataOf('friend-a').updatedAt;
    const first = await putMetadata('key-admin', 'friend-a', { __attention: '1' }, base);
    expect(first.status).toBe(200);
    const second = await putMetadata('key-admin', 'friend-a', { __attention: null }, base);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('METADATA_CONFLICT');
    expect(metadataOf('friend-a').metadata).toBe(JSON.stringify({ __attention: '1' }));
  });

  it('正常更新は新しいupdatedAtを返し次はその値で通る', async () => {
    const base = metadataOf('friend-a').updatedAt;
    const first = await putMetadata('key-admin', 'friend-a', { __attention: '1' }, base);
    expect(first.status).toBe(200);
    const next = first.body.data.updatedAt as string;
    expect(next).not.toBe(base);
    const second = await putMetadata('key-admin', 'friend-a', { memo: 'x' }, next);
    expect(second.status).toBe(200);
    expect(metadataOf('friend-a').metadata).toBe(JSON.stringify({ __attention: '1', memo: 'x' }));
  });

  it('改訂値なしは従来どおり200（既存互換）', async () => {
    const response = await putMetadata('key-admin', 'friend-a', { __attention: '1' });
    expect(response.status).toBe(200);
    expect(metadataOf('friend-a').metadata).toBe(JSON.stringify({ __attention: '1' }));
  });

  it('存在しない友だちは404', async () => {
    const response = await putMetadata('key-admin', 'friend-missing', { __attention: '1' }, '2026-09-14T20:00:00.000+09:00');
    expect(response.status).toBe(404);
  });

  it('未認証は401、別統括は404', async () => {
    expect((await putMetadata(undefined, 'friend-a', { __attention: '1' })).status).toBe(401);
    expect((await putMetadata('key-admin', 'friend-foreign', { __attention: '1' }, '2026-09-14T20:00:00.000+09:00')).status).toBe(404);
  });

  it('割当外staffは404、割当内staffは改訂付きで200', async () => {
    expect((await putMetadata('key-partial', 'friend-foreign', { __attention: '1' })).status).toBe(404);
    const base = metadataOf('friend-a').updatedAt;
    const response = await putMetadata('key-partial', 'friend-a', { __attention: '1' }, base);
    expect(response.status).toBe(200);
  });
});
