import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createForm } from '@line-crm/db';
import { emptyLayout, normalizeFormTheme } from '@line-crm/shared';
import { forms } from './forms.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
let t: SqliteD1;
function app(role: 'owner' | 'staff' = 'owner', readOnly = false, keys = ['/form-submissions']) {
  const app = new Hono<Env>();
  app.use('*', async(c, next) => { c.env = { DB: t.db } as Env['Bindings']; c.set('staff', { id: 'env-owner', role, name: '管理者', readOnly, permissionKeys: keys }); await next(); });
  app.route('/', forms); return app;
}
beforeEach(() => { t = createTestD1(); t.raw.prepare("INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','ch','店','token','secret')").run(); });
afterEach(() => t.raw.close());
describe('フォームの警告とCSV', () => {
  test('読みにくい色も作成・更新・公開でき、警告を返す', async () => {
    const layout = emptyLayout(); layout.options.theme = normalizeFormTheme({ main: '#ffffff', sub: '#ffffff', text: '#ffffff' });
    const created = await app().request('/api/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '試験', accountId: 'a', layout }) });
    expect(created.status).toBe(201);
    const data = (await created.json() as { data: { id: string; warnings: unknown[] } }).data;
    expect(data.warnings).toEqual([expect.objectContaining({ code: 'LOW_CONTRAST' })]);
    const saved = await app().request(`/api/forms/${data.id}?account_id=a`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout, expectedContentRevision: 1 }) });
    expect(saved.status).toBe(200);
    const revision = (await saved.json() as { data: { contentRevision: number } }).data.contentRevision;
    const published = await app().request(`/api/forms/${data.id}/publish?account_id=a`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedContentRevision: revision }) });
    expect(published.status).toBe(200);
  });
  test('CSVは閲覧のみと権限なしを断り、許可者だけ取得できる', async () => {
    const form = await createForm(t.db, { name: '試験', fields: '[]', lineAccountIds: ['a'] });
    const path = `/api/forms/${form.id}/exports?account_id=a`;
    expect((await app('owner', true).request(path, { method: 'POST' })).status).toBe(403);
    expect((await app('staff').request(path, { method: 'POST' })).status).toBe(403);
    const response = await app('owner').request(path, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(await response.text()).toContain('回答ID');
  });
});
