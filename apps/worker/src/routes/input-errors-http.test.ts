import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { templates } from './templates.js';
import { tags } from './tags.js';
import { broadcasts } from './broadcasts.js';
import { scenarios } from './scenarios.js';
import { forms } from './forms.js';
import { richMenuGroups } from './rich-menu-groups.js';
import { messageTemplates } from './message-templates.js';
import { lineAccountTags } from './line-account-tags.js';
import { hqTemplates } from './hq-templates.js';
import { hqBroadcasts } from './hq-broadcasts.js';
import { broadcastMessageAssets } from './broadcast-message-assets.js';
import booking from './booking.js';

let fixture: SqliteD1;
let app: Hono<Env>;
beforeEach(() => {
  fixture = createTestD1();
  fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
    VALUES('shop','試験','fixture','fixture','fixture',?)`).run(DEFAULT_TENANT_ID);
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id)
    VALUES('owner','管理者','owner','fixture',?)`).run(DEFAULT_TENANT_ID);
  app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner', name: '管理者', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID });
    await next();
  });
  // 本番と同じ順で実ルートを組み合わせる。入力不備で保存されないことも確認する。
  for (const route of [templates, tags, broadcasts, scenarios, forms, richMenuGroups,
    messageTemplates, lineAccountTags, hqTemplates, hqBroadcasts, broadcastMessageAssets, booking]) app.route('/', route);
});
afterEach(() => fixture.raw.close());
const request = (path: string, body: unknown, method = 'POST') => app.request(path, {
  method, headers: { 'Content-Type': 'application/json', ...(path.startsWith('/api/booking/') ? { 'Idempotency-Key': crypto.randomUUID() } : {}) }, body: JSON.stringify(body),
}, { DB: fixture.db, IMAGES: {} } as Env['Bindings']);

describe('B-154 欄ごとの入力エラーを実HTTPで返す', () => {
  it.each([
    ['/api/templates', { accountId: 'shop' }, 'name'],
    ['/api/broadcasts', {}, 'title'],
    ['/api/tags', { lineAccountId: 'shop' }, 'name'],
    ['/api/forms', { accountId: 'shop' }, 'name'],
    ['/api/scenarios', {}, 'name'],
    ['/api/rich-menu-groups', { accountId: 'shop' }, 'name'],
    ['/api/message-templates', {}, 'name'],
    ['/api/broadcast-message-assets', { kind: 'rich_message', lineAccountId: 'shop' }, 'name'],
    ['/api/line-account-tags', {}, 'name'],
    ['/api/hq/templates', { requestId: 'field-test-1', type: 'tag', definition: { schemaVersion: 1, tag: { name: '試験' }, folders: [] } }, 'name'],
    ['/api/hq/broadcasts', {}, 'title'],
    ['/api/booking/admin/bookings?account_id=shop', {}, 'menu_id'],
  ])('%s: 欠けた欄を400のfieldsへ返す', async (path, body, key) => {
    const response = await request(path, body);
    expect(response.status).toBe(400);
    const payload = await response.json<{ error: string; fields: Record<string, string> }>();
    expect(payload.error).toEqual(expect.any(String));
    expect(payload.fields[key]).toEqual(expect.any(String));
    expect(payload.fields[key].length).toBeGreaterThan(0);
    for (const table of ['templates', 'broadcasts', 'tags', 'forms', 'scenarios', 'rich_menu_groups', 'hq_templates', 'hq_broadcast_runs']) {
      expect(fixture.raw.prepare(`SELECT COUNT(*) count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });
  it.each([
    ['/api/templates', { accountId: 'shop', name: '試験', messageType: 'flex', messageContent: 'JSONではない' }, 'messageContent', 422],
    ['/api/broadcasts', { title: 123 }, 'title', 400],
    ['/api/booking/admin/bookings?account_id=shop', { menu_id: 123 }, 'menu_id', 400],
    ['/api/tags', { lineAccountId: 'shop', name: '試験', mileage: { self: -1 } }, 'mileage.self', 422],
    ['/api/scenarios', { name: '試験', triggerType: 'manual', deliveryMode: 'invalid' }, 'deliveryMode', 400],
    ['/api/forms', { accountId: 'shop', name: '試験', layout: 'invalid' }, 'layout', 400],
    ['/api/rich-menu-groups', { accountId: 'shop', name: '試験', chatBarText: '開く', size: 'invalid' }, 'size', 400],
    ['/api/message-templates', { name: '試験', messageType: 'flex', messageContent: 'JSONではない' }, 'messageContent', 422],
    ['/api/line-account-tags', { name: '試験', color: 'invalid' }, 'color', 400],
    ['/api/broadcast-message-assets', { kind: 'rich_message', lineAccountId: 'shop', name: '試験', payload: {} }, 'payload', 400],
    ['/api/hq/templates', { requestId: 'field-test-2', type: 'tag', name: '試験', definition: {} }, 'definition', 400],
    ['/api/hq/templates/id/preflight', { accountIds: 'invalid' }, 'accountIds', 400],
    ['/api/hq/broadcasts/folders', { name: '試験', color: 'invalid' }, 'color', 422],
  ])('%s: 不正な値を該当欄へ返す', async (path, body, key, status) => {
    const response = await request(path, body);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: expect.any(String), fields: { [key]: expect.any(String) } });
  });
  it('テンプレートの編集も欄別の理由を返し、保存済みの本文を壊さない', async () => {
    const created = await request('/api/templates', { accountId: 'shop', name: '保存済み', messageType: 'text', messageContent: '元の本文' });
    expect(created.status).toBe(201);
    const { data } = await created.json<{ data: { id: string } }>();
    const wrongType = await request(`/api/templates/${data.id}`, { name: 12 }, 'PUT');
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toMatchObject({ fields: { name: expect.any(String) } });
    const wrongContent = await request(`/api/templates/${data.id}`, { messageType: 'flex', messageContent: 'JSONではない' }, 'PUT');
    expect(wrongContent.status).toBe(422);
    expect(await wrongContent.json()).toMatchObject({ fields: { messageContent: expect.any(String) } });
    expect(fixture.raw.prepare('SELECT name,message_content FROM templates WHERE id=?').get(data.id)).toEqual({ name: '保存済み', message_content: '元の本文' });
  });
  it.each(['{', 'null', '[]', '1', '"文字"'])('不正なJSON本文 %s は500にしない', async body => {
    const response = await app.request('/api/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }, { DB: fixture.db } as Env['Bindings']);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String), fields: {} });
  });
});
