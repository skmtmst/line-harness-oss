import { Hono } from 'hono';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { FOLDER_SELECT_COLORS } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { hqTemplates } from './hq-templates.js';
import { hqBroadcasts } from './hq-broadcasts.js';
import { friendAddRules } from './friend-add-rules.js';
import type { Env } from '../index.js';
let fixture: SqliteD1, app: Hono<Env>, staff: any;
beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  fixture.raw.exec("INSERT INTO tenants(id,name) VALUES('tenant','試験'),('other','別の統括'); INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','担当','owner','fixture','tenant'); INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES('shop','店','channel','fixture','fixture','tenant'),('other-shop','別の店','other-channel','fixture','fixture','other')");
  staff = { id: 'owner', name: '担当', role: 'owner', tenantId: 'tenant', readOnly: false };
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', staff); await next(); });
  app.route('/', hqTemplates); app.route('/', hqBroadcasts); app.route('/', friendAddRules);
});
afterEach(() => fixture.raw.close());
async function call(path: string, method = 'GET', body?: unknown, key = 'folder-key-00000001') {
  const response = await app.request(path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: fixture.db } as Env['Bindings']);
  return { status: response.status, body: await response.json() as any };
}
const kinds = [
  { path: '/api/hq/templates/folders', version: 'expectedRevision' },
  { path: '/api/hq/broadcasts/folders', version: 'expectedVersion' },
  { path: '/api/friend-add-rules/folders', version: null },
];
describe.each(kinds)('$path の色（実HTTP・SQL）', ({ path, version }) => {
  it('6色とNULLを保存して返し、名前だけの変更で色を失わず、古い版と他の所属を拒む', async () => {
    for (const [index, color] of [...FOLDER_SELECT_COLORS.map(item => item.value), null].entries()) {
      const created = await call(path, 'POST', { accountId: 'shop', name: `分類${index}`, color }, `folder-key-${index}-00000000`);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.data.color).toBe(color);
    }
    const created = await call(path, 'POST', { accountId: 'shop', name: '保存', color: '#ef4444' }, 'folder-key-target-00000');
    const id = created.body.data.id;
    const changed = await call(`${path}/${id}`, 'PATCH', { accountId: 'shop', name: '改名', ...(version ? { [version]: 1 } : {}) });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data).toMatchObject({ id, name: '改名', color: '#ef4444' });
    if (version) expect((await call(`${path}/${id}`, 'PATCH', { name: '古い変更', color: null, [version]: 1 })).status).toBe(409);
    const cleared = await call(`${path}/${id}`, 'PATCH', { accountId: 'shop', name: '改名', color: null, ...(version ? { [version]: 2 } : {}) });
    expect(cleared.status).toBe(200); expect(cleared.body.data.color).toBeNull();
    const list = await call(version ? path : '/api/friend-add-rules?account_id=shop&kind=first_time');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const folders = version ? list.body.data : list.body.data.options.folders;
    expect(folders).toEqual(expect.arrayContaining([expect.objectContaining({ id, color: null }), expect.objectContaining({ name: '分類0', color: '#3b82f6' })]));
    staff.tenantId = 'other';
    expect((await call(`${path}/${id}`, 'PATCH', { accountId: 'other-shop', name: '横取り', color: '#16a34a', ...(version ? { [version]: 3 } : {}) })).status).toBeGreaterThanOrEqual(400);
  });
  it('パレット外の値や型を拒み、閲覧のみから作らせない', async () => {
    for (const color of ['#123456', '#123', 'red', 1, {}, false]) expect((await call(path, 'POST', { accountId: 'shop', name: '不可', color })).status).toBe(422);
    const plain = await call(path, 'POST', { accountId: 'shop', name: '色なし' });
    expect(plain.status).toBe(201); expect(plain.body.data.color).toBeNull();
    expect((await call(`${path}/${plain.body.data.id}`, 'PATCH', { accountId: 'shop', name: '改名', color: '#123456', ...(version ? { [version]: 1 } : {}) })).status).toBe(422);
    staff.readOnly = true;
    // 店の閲覧のみは共通authMiddlewareで止まる。ここではフォルダの役割ゲートを通す。
    if (!version) staff.role = 'staff';
    expect((await call(path, 'POST', { accountId: 'shop', name: '不可', color: '#ef4444' })).status).toBe(403);
  });
});
it('友だち追加の冪等再送は最初の名前と色を返す。改名はその店の設定だけに反映する', async () => {
  const path = '/api/friend-add-rules/folders';
  const first = await call(path, 'POST', { accountId: 'shop', name: '店頭', color: '#8b5cf6' });
  const replay = await call(path, 'POST', { accountId: 'shop', name: '別名', color: '#ef4444' });
  expect(replay.status).toBe(200); expect(replay.body.data).toEqual(first.body.data);
  fixture.raw.exec("INSERT INTO friend_add_rules(id,line_account_id,friend_kind,name,folder_name,priority,status,created_at,updated_at) VALUES('r','shop','first_time','設定','店頭',1,'draft','now','now'),('other-r','other-shop','first_time','設定','店頭',1,'draft','now','now')");
  expect((await call(`${path}/${first.body.data.id}`, 'PATCH', { accountId: 'shop', name: '店の入口', color: '#16a34a' })).status).toBe(200);
  expect(fixture.raw.prepare('SELECT id,folder_name,lock_version FROM friend_add_rules ORDER BY id').all()).toEqual([{ id: 'other-r', folder_name: '店頭', lock_version: 1 }, { id: 'r', folder_name: '店の入口', lock_version: 2 }]);
});
