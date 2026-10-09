import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendAddRules } from './friend-add-rules.js';
import type { Env } from '../index.js';

let fixture: SqliteD1, app: Hono<Env>;
beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  const raw = fixture.raw;
  raw.prepare("INSERT INTO tenants(id,name) VALUES('other-tenant','別の統括')").run();
  for (const [id, tenant] of [['a', DEFAULT_TENANT_ID], ['b', DEFAULT_TENANT_ID], ['other', 'other-tenant']]) {
    raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES(?,?,?,'fixture','fixture',?)").run(id, id, id, tenant);
  }
  for (const [id, role, access, scope] of [['owner', 'owner', 'full', 'all'], ['admin', 'admin', 'full', 'accounts'], ['staff', 'staff', 'full', 'all'], ['readonly', 'owner', 'read_only', 'all']]) {
    raw.prepare('INSERT INTO staff_members(id,name,role,access_level,api_key,tenant_id,account_scope) VALUES(?,?,?,?,?,?,?)').run(id, id, role, access, `${id}-key`, DEFAULT_TENANT_ID, scope);
  }
  raw.exec("INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('admin','a','now')");
  for (const id of ['a', 'b', 'other']) {
    raw.prepare(`INSERT INTO friend_add_rule_folders(id,line_account_id,name,create_idempotency_key,created_by_staff_id,created_at,updated_at)
      VALUES(?,?,'店頭',?,'owner','now','now')`).run(`folder-${id}`, id, `key-${id}`);
    raw.prepare(`INSERT INTO friend_add_rules(id,line_account_id,friend_kind,name,folder_name,priority,status)
      VALUES(?,?,'first_time','案内','店頭',1,'published')`).run(`rule-${id}`, id);
  }
  raw.exec(`INSERT INTO friend_add_rule_versions(id,rule_id,version_number,definition_snapshot,status)
    VALUES('version','rule-a',1,'{"messageText":"案内"}','published')`);
  app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friendAddRules);
});
afterEach(() => { vi.restoreAllMocks(); fixture.raw.close(); });
function call(path = '/api/friend-add-rules/folders/folder-a?account_id=a', key = 'owner-key', body?: unknown) {
  return app.request(path, { method: 'DELETE', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: fixture.db });
}
function rule(id = 'rule-a') { return fixture.raw.prepare('SELECT folder_name,lock_version,status FROM friend_add_rules WHERE id=?').get(id); }

it('フォルダだけ消し、設定は未分類へ、公開版は残し、再送は404', async () => {
  const versions = fixture.raw.prepare('SELECT * FROM friend_add_rule_versions').all();
  const response = await call();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, data: { id: 'folder-a', deleted: true } });
  expect(rule()).toEqual({ folder_name: null, lock_version: 2, status: 'published' });
  expect(rule('rule-b')).toEqual({ folder_name: '店頭', lock_version: 1, status: 'published' });
  expect(fixture.raw.prepare('SELECT * FROM friend_add_rule_versions').all()).toEqual(versions);
  expect((await call()).status).toBe(404);
});
it('対象店に限定されたadminは本文のアカウント指定で削除できる', async () => {
  expect((await call('/api/friend-add-rules/folders/folder-a', 'admin-key', { accountId: 'a' })).status).toBe(200);
});
it.each(['staff-key', 'readonly-key'])('編集できない人は削除できない: %s', async key => {
  expect((await call(undefined, key)).status).toBe(403);
  expect(rule()).toMatchObject({ folder_name: '店頭', lock_version: 1 });
});
it('未認証・店の範囲外・別テナント・フォルダの所有店違いを拒む', async () => {
  expect((await call(undefined, 'missing-key')).status).toBe(401);
  expect((await call('/api/friend-add-rules/folders/folder-b?account_id=b', 'admin-key')).status).toBe(404);
  expect((await call('/api/friend-add-rules/folders/folder-other?account_id=other')).status).toBe(404);
  expect((await call('/api/friend-add-rules/folders/folder-b?account_id=a')).status).toBe(404);
  expect(rule()).toMatchObject({ folder_name: '店頭', lock_version: 1 });
});
it('アカウント未指定と壊れた本文を400で返す', async () => {
  expect((await call('/api/friend-add-rules/folders/folder-a')).status).toBe(400);
  for (const body of [[], 'a', { accountId: 1 }]) expect((await call('/api/friend-add-rules/folders/folder-a', 'owner-key', body)).status).toBe(400);
  expect((await app.request('/api/friend-add-rules/folders/folder-a?account_id=a', {
    method: 'DELETE', headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json' }, body: '{broken',
  }, { DB: fixture.db })).status).toBe(400);
});
it('読み取り後の改名は409となり未分類への変更は起きない', async () => {
  const versions = fixture.raw.prepare('SELECT * FROM friend_add_rule_versions').all();
  const batch = fixture.db.batch.bind(fixture.db);
  vi.spyOn(fixture.db, 'batch').mockImplementationOnce((statements) => {
    fixture.raw.exec("UPDATE friend_add_rule_folders SET name='改名' WHERE id='folder-a'");
    return batch(statements);
  });
  const response = await call();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ success: false, code: 'VERSION_CONFLICT' });
  // 617は別の更新者の改名を設定へ同期する。削除の失敗ではその成功を戻さない。
  expect(rule()).toEqual({ folder_name: '改名', lock_version: 2, status: 'published' });
  expect(fixture.raw.prepare('SELECT * FROM friend_add_rule_versions').all()).toEqual(versions);
});
it('最後の書き込みの失敗は500で返し、設定の分類と版を戻す', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  fixture.raw.exec("CREATE TRIGGER reject_folder_delete BEFORE DELETE ON friend_add_rule_folders BEGIN SELECT RAISE(ABORT,'test_delete_failure'); END;");
  expect((await call()).status).toBe(500);
  expect(rule()).toMatchObject({ folder_name: '店頭', lock_version: 1 });
});
