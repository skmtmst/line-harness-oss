import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { tags } from './tags.js';
import { lineAccountTags } from './line-account-tags.js';
import { hqTemplates } from './hq-templates.js';
let fixture: SqliteD1, app: Hono<Env>;
beforeEach(() => {
  fixture = createTestD1();
  fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
    VALUES('shop','試験','fixture','fixture','fixture',?)`).run(DEFAULT_TENANT_ID);
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id)
    VALUES('owner','管理者','owner','fixture',?)`).run(DEFAULT_TENANT_ID);
  fixture.raw.exec("INSERT INTO tags(id,name,line_account_id,color) VALUES('existing','既存','shop','')");
  app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner', name: '管理者', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID });
    await next();
  });
  app.route('/', tags); app.route('/', lineAccountTags); app.route('/', hqTemplates);
});
afterEach(() => fixture.raw.close());
const create = (path: string, body: unknown) => app.request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}, { DB: fixture.db } as Env['Bindings']);
describe('B-156 新しいタグの既定色', () => {
  it.each([{ name: '旧口' }, { name: '新口', lineAccountId: 'shop' }])('店のタグを色なしで作ると灰色を返し、保存する: $name', async body => {
    const response = await create('/api/tags', body);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { color: '#94a3b8' } });
    expect(fixture.raw.prepare('SELECT color FROM tags WHERE name=?').get(body.name)).toEqual({ color: '#94a3b8' });
    expect(fixture.raw.prepare("SELECT color FROM tags WHERE id='existing'").get()).toEqual({ color: '' });
  });
  it('統括のアカウントタグも既定を灰色にし、指定した色は残す', async () => {
    const response = await create('/api/line-account-tags', { name: '直営' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { color: '#94a3b8' } });
    const colored = await create('/api/line-account-tags', { name: '支店', color: '#123456' });
    expect(await colored.json()).toMatchObject({ data: { color: '#123456' } });
  });
  it('統括の配布用タグの色なしも灰色で保存する', async () => {
    const response = await create('/api/hq/templates', { requestId: 'gray-tag-default', type: 'tag', name: '配るタグ',
      definition: { schemaVersion: 1, tag: { name: '常連' }, folders: [] } });
    expect(response.status).toBe(201);
    const payload = await response.json<{ data: { definition: { tag: { color: string } } } }>();
    expect(payload.data.definition.tag.color).toBe('#94a3b8');
  });
});
