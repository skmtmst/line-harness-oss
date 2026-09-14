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
  insertAccount.run('account-b', 'channel-b', '店舗B', DEFAULT_TENANT_ID);
  insertAccount.run('account-foreign', 'channel-foreign', '別統括店舗', OTHER_TENANT_ID);

  const insertStaff = raw.prepare(`
    INSERT INTO staff_members
      (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?)
  `);
  insertStaff.run('admin-all', '統括管理者', 'admin', 'full', 'key-admin', 'all', DEFAULT_TENANT_ID);
  insertStaff.run('staff-partial', '店舗A担当', 'staff', 'full', 'key-partial', 'accounts', DEFAULT_TENANT_ID);
  raw.prepare(`UPDATE staff_members SET permission_keys = '["/friends"]' WHERE id = 'staff-partial'`).run();
  insertStaff.run('staff-readonly', '閲覧のみ', 'staff', 'read_only', 'key-readonly', 'all', DEFAULT_TENANT_ID);
  raw.prepare(`
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES ('staff-partial', 'account-a', '2026-09-09T00:00:00.000Z')
  `).run();

  insertFriend(raw, 'friend-a', { line_account_id: 'account-a' });
  insertFriend(raw, 'friend-foreign', { line_account_id: 'account-foreign' });

  const insertTag = raw.prepare(`
    INSERT INTO tags (id, name, normalized_name, line_account_id, manual_assignment_allowed)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertTag.run('tag-a', 'タグA', 'タグa', 'account-a', 1);
  insertTag.run('tag-b', 'タグB', 'タグb', 'account-b', 1);
  insertTag.run('tag-off', '手動禁止タグ', '手動禁止タグ', 'account-a', 0);
  insertTag.run('tag-global', '共通タグ', '共通タグ', null, 1);
  insertTag.run('tag-foreign', '別統括タグ', '別統括タグ', 'account-foreign', 1);
}

describe('N-041/N-044 タグ付与の所属と手動禁止 (#803)', () => {
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

  async function postTag(apiKey: string | undefined, friendId: string, body: unknown): Promise<Response> {
    return target.app.request(`/api/friends/${friendId}/tags`, {
      method: 'POST',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, target.env);
  }

  function assignedTagIds(friendId: string): string[] {
    return (testDb.raw.prepare('SELECT tag_id AS id FROM friend_tags WHERE friend_id = ? ORDER BY tag_id')
      .all(friendId) as Array<{ id: string }>).map((row) => row.id);
  }

  it('N-041: 別所属のタグは付けられず存在も漏らさない', async () => {
    const response = await postTag('key-admin', 'friend-a', { tagId: 'tag-b' });
    expect(response.status).toBe(404);
    expect(assignedTagIds('friend-a')).toEqual([]);
  });

  it('N-041: 同一所属のタグは付けられる', async () => {
    const response = await postTag('key-admin', 'friend-a', { tagId: 'tag-a' });
    expect(response.status).toBe(201);
    expect(assignedTagIds('friend-a')).toEqual(['tag-a']);
  });

  it('N-041: 所属なしの共通タグは従来どおり付けられる', async () => {
    const response = await postTag('key-admin', 'friend-a', { tagId: 'tag-global' });
    expect(response.status).toBe(201);
    expect(assignedTagIds('friend-a')).toEqual(['tag-global']);
  });

  it('N-041: 部分権限staffは割当外の所属タグを付けられない', async () => {
    expect((await postTag('key-partial', 'friend-a', { tagId: 'tag-a' })).status).toBe(201);
    const response = await postTag('key-partial', 'friend-a', { tagId: 'tag-b' });
    expect(response.status).toBe(404);
    expect(assignedTagIds('friend-a')).toEqual(['tag-a']);
  });

  it('N-041: 別統括の友だち・タグには触れない', async () => {
    expect((await postTag('key-admin', 'friend-foreign', { tagId: 'tag-a' })).status).toBe(404);
    expect((await postTag('key-admin', 'friend-a', { tagId: 'tag-foreign' })).status).toBe(404);
    expect(assignedTagIds('friend-a')).toEqual([]);
    expect(assignedTagIds('friend-foreign')).toEqual([]);
  });

  it('N-041: ないタグも同じ404で存在を漏らさない', async () => {
    const response = await postTag('key-admin', 'friend-a', { tagId: 'tag-missing' });
    expect(response.status).toBe(404);
    expect(assignedTagIds('friend-a')).toEqual([]);
  });

  it('N-041: owner/admin互換とread-only拒否', async () => {
    expect((await postTag('key-admin', 'friend-a', { tagId: 'tag-a' })).status).toBe(201);
    const readonlyResponse = await postTag('key-readonly', 'friend-a', { tagId: 'tag-a' });
    expect(readonlyResponse.status).toBe(403);
  });

  it('N-044: 手動禁止タグは付けられず存在も漏らさない', async () => {
    const response = await postTag('key-admin', 'friend-a', { tagId: 'tag-off' });
    expect(response.status).toBe(404);
    expect(assignedTagIds('friend-a')).toEqual([]);
  });

  it('N-044: 部分権限staffの手動禁止タグも付けられない', async () => {
    const response = await postTag('key-partial', 'friend-a', { tagId: 'tag-off' });
    expect(response.status).toBe(404);
    expect(assignedTagIds('friend-a')).toEqual([]);
  });
});
