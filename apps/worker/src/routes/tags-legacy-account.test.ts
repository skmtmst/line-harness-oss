import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { tags } from './tags.js';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';

function createApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', tags);
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
  insertStaff.run('owner-all', '既定統括owner', 'owner', 'full', 'key-owner', 'all', DEFAULT_TENANT_ID);
  insertStaff.run('admin-single', '店舗A管理者', 'admin', 'full', 'key-single', 'accounts', DEFAULT_TENANT_ID);
  insertStaff.run('admin-readonly', '閲覧管理者', 'admin', 'read_only', 'key-ro', 'all', DEFAULT_TENANT_ID);
  raw.prepare(`
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES ('admin-single', 'account-a', '2026-09-09T00:00:00.000Z')
  `).run();
}

describe('N-048 旧タグ作成・CSV一括の所属確定 (#803)', () => {
  let testDb: SqliteD1;
  let target: ReturnType<typeof createApp>;

  beforeEach(() => {
    const fixture = createTestD1();
    testDb = fixture;
    seed(testDb);
    // D1 run()はINSERT RETURNINGの行を返す。汎用fixtureはchangesだけなので、
    // 一括作成の成否判定には実SQLiteのRETURNINGを使う(一意性は模擬しない)。
    const prepare = testDb.db.prepare.bind(testDb.db);
    testDb.db.prepare = ((query: string) => {
      if (!/^INSERT OR IGNORE INTO tags/.test(query)) return prepare(query);
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const results = fixture.raw.prepare(query).all(...args);
            return { success: true, results, meta: { changes: results.length } };
          },
        }),
      };
    }) as D1Database['prepare'];
    target = createApp(testDb.db);
  });

  afterEach(() => {
    testDb.raw.close();
  });

  async function post(path: string, apiKey: string | undefined, body: unknown): Promise<{ status: number; body: any }> {
    const response = await target.app.request(path, {
      method: 'POST',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, target.env);
    return { status: response.status, body: await response.json() as any };
  }

  function tagAccounts(): Array<{ name: string; line_account_id: string | null }> {
    return testDb.raw.prepare('SELECT name, line_account_id FROM tags ORDER BY name').all() as Array<{
      name: string;
      line_account_id: string | null;
    }>;
  }

  it('旧作成: 割当が絞れないままは400で所属なし行を作らない', async () => {
    const response = await post('/api/tags', 'key-owner', { name: 'あいまいタグ' });
    expect(response.status).toBe(400);
    expect(tagAccounts()).toEqual([]);
  });

  it('旧作成: 単一割当の管理者はその所属で作られる', async () => {
    const response = await post('/api/tags', 'key-single', { name: '店舗Aタグ' });
    expect(response.status).toBe(201);
    expect(tagAccounts()).toEqual([{ name: '店舗Aタグ', line_account_id: 'account-a' }]);
  });

  it('旧作成: 明示IDは検証のうえ採用される', async () => {
    const response = await post('/api/tags', 'key-owner', { name: '店舗Bタグ', lineAccountId: 'account-b' });
    expect(response.status).toBe(201);
    expect(tagAccounts()).toEqual([{ name: '店舗Bタグ', line_account_id: 'account-b' }]);
  });

  it('旧作成: 範囲外の明示IDは存在を漏らさず拒否される', async () => {
    const response = await post('/api/tags', 'key-owner', { name: '別統括タグ', lineAccountId: 'account-foreign' });
    expect(response.status).toBe(404);
    expect(tagAccounts()).toEqual([]);
  });

  it('旧作成: 同じ名前の二重登録は409', async () => {
    expect((await post('/api/tags', 'key-single', { name: '重複タグ' })).status).toBe(201);
    expect((await post('/api/tags', 'key-single', { name: '重複タグ' })).status).toBe(409);
    expect(tagAccounts()).toEqual([{ name: '重複タグ', line_account_id: 'account-a' }]);
  });

  it('旧作成: read-onlyは403', async () => {
    const response = await post('/api/tags', 'key-ro', { name: '見るだけタグ' });
    expect(response.status).toBe(403);
    expect(tagAccounts()).toEqual([]);
  });

  it('CSV一括: 割当が絞れないままは400で所属なし行を作らない', async () => {
    const response = await post('/api/tags/import', 'key-owner', { rows: [{ line: 2, name: '一括あいまい', folderName: '' }] });
    expect(response.status).toBe(400);
    expect(tagAccounts()).toEqual([]);
  });

  it('CSV一括: 単一割当の管理者はその所属で作られる', async () => {
    const response = await post('/api/tags/import', 'key-single', { rows: [{ line: 2, name: '一括A', folderName: '' }] });
    expect(response.status).toBe(200);
    expect(response.body.data.rows[0].status).toBe('created');
    expect(tagAccounts()).toEqual([{ name: '一括A', line_account_id: 'account-a' }]);
  });

  it('CSV一括: 明示IDは検証のうえ採用される', async () => {
    const response = await post(
      '/api/tags/import?lineAccountId=account-b',
      'key-owner',
      { rows: [{ line: 2, name: '一括B', folderName: '' }] },
    );
    expect(response.status).toBe(200);
    expect(tagAccounts()).toEqual([{ name: '一括B', line_account_id: 'account-b' }]);
  });

  it('CSV確認: 割当が絞れないままは保存前に400で止まる', async () => {
    const response = await post('/api/tags/import/preview', 'key-owner', { rows: [{ line: 2, name: '確認あいまい', folderName: '' }] });
    expect(response.status).toBe(400);
    expect(tagAccounts()).toEqual([]);
  });
});
