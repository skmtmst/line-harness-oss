import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendFields } from './friend-fields.js';

function createApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friendFields);
  return { app, env: { DB: db } as Env['Bindings'] };
}

function seed(testDb: SqliteD1): void {
  const { raw } = testDb;
  raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)').run(DEFAULT_TENANT_ID, '既定統括');
  raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES (?, ?, ?, 'token', 'secret', 1, ?)
  `).run('account-a', 'channel-a', '店舗A', DEFAULT_TENANT_ID);

  raw.prepare(`
    INSERT INTO staff_members
      (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?)
  `).run('owner-all', '既定統括owner', 'owner', 'full', 'key-owner', 'all', DEFAULT_TENANT_ID);

  insertFriend(raw, 'f1', { line_account_id: 'account-a' });

  raw.prepare(`INSERT INTO friend_fields (id, name, field_key, type) VALUES ('fld-a', 'メモA', 'memo_a', 'text')`).run();
  raw.prepare(`INSERT INTO friend_fields (id, name, field_key, type) VALUES ('fld-b', 'メモB', 'memo_b', 'text')`).run();
}

/**
 * M046：項目保存の途中失敗で部分保存になる。
 * 2件中の2件目を落とすと500を返すが、1件目が残ったまま。
 * 複数項目の保存は同じ取引で確定し、途中失敗では全部戻す。
 */
describe('M046 項目保存の原子性', () => {
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

  async function putFields(body: unknown): Promise<{ status: number; body: any }> {
    const response = await target.app.request('/api/friends/f1/fields', {
      method: 'PUT',
      headers: { Authorization: 'Bearer key-owner', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, target.env);
    return { status: response.status, body: await response.json() as any };
  }

  function valuesOf(): Array<{ field_id: string; value: string | null }> {
    return testDb.raw.prepare(
      'SELECT field_id, value FROM friend_field_values ORDER BY field_id',
    ).all() as Array<{ field_id: string; value: string | null }>;
  }

  it('対照: 書き込み途中の失敗は500で永続変更0件', async () => {
    testDb.db.batch = (async () => {
      throw new Error('simulated mid-batch DB failure');
    }) as D1Database['batch'];
    target = createApp(testDb.db);

    const response = await putFields({ values: { 'fld-a': 'Aの値', 'fld-b': 'Bの値' } });
    expect(response.status).toBe(500);
    expect(valuesOf()).toEqual([]);
  });

  it('正常: 2件とも書けて件数を返す', async () => {
    const response = await putFields({ values: { 'fld-a': 'Aの値', 'fld-b': 'Bの値' } });
    expect(response.status).toBe(200);
    expect(response.body.data.updated).toBe(2);
    expect(valuesOf()).toEqual([
      { field_id: 'fld-a', value: 'Aの値' },
      { field_id: 'fld-b', value: 'Bの値' },
    ]);
  });
});
