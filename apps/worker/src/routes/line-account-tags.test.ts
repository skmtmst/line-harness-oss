import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { replaceLineAccountTags } from '@line-crm/db';
import { lineAccountTags } from './line-account-tags.js';
import { lineAccounts } from './line-accounts.js';

let db: SqliteD1;
let staff: AuthenticatedStaff;
function call(method: string, path: string, body?: unknown) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { ...staff }); await next(); });
  app.use('/api/*', featureEnforcementMiddleware);
  app.route('/', lineAccountTags);
  app.route('/', lineAccounts);
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db.db } as Env['Bindings']);
}
async function tag(name = '本店', color: string | null = '#00aaff') {
  const response = await call('POST', '/api/line-account-tags', { name, color, displayOrder: 2 });
  expect(response.status).toBe(201);
  return (await response.json<{ data: { id: string; name: string } }>()).data;
}
beforeEach(() => {
  db = createTestD1({ foreignKeys: true });
  staff = { id: 'owner', name: '試験', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID };
  db.raw.exec(`INSERT INTO tenants(id, name) VALUES ('tenant-other', '別統括');
    INSERT INTO line_accounts(id, name, channel_id, channel_secret, channel_access_token, tenant_id) VALUES
      ('a', '本店', 'a', 'unused', 'unused', '${DEFAULT_TENANT_ID}'),
      ('b', '支店', 'b', 'unused', 'unused', '${DEFAULT_TENANT_ID}'),
      ('other', '別統括', 'other', 'unused', 'unused', 'tenant-other');`);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('外部呼び出し禁止'); }));
});
afterEach(() => { db.raw.close(); vi.unstubAllGlobals(); });

describe('統括内のアカウントタグ', () => {
  it('作成・色と並び順の変更・一覧が動き、同名は409になる', async () => {
    const t = await tag();
    expect((await call('POST', '/api/line-account-tags', { name: '本店' })).status).toBe(409);
    const changed = await call('PATCH', `/api/line-account-tags/${t.id}`, { name: '直営', color: null, displayOrder: 0 });
    expect(changed.status).toBe(200);
    expect(db.raw.prepare("SELECT action FROM audit_events WHERE action = 'line_account_tag.update'").get()).toEqual({ action: 'line_account_tag.update' });
    expect(await changed.json()).toMatchObject({ data: { name: '直営', color: null, displayOrder: 0 } });
    expect(await (await call('GET', '/api/line-account-tags')).json()).toMatchObject({ data: [{ id: t.id, name: '直営' }] });
  });
  it('付け外しを置き換え、重複IDを1件にし、旧一覧の情報を残す', async () => {
    const t = await tag();
    const path = '/api/line-accounts/a/tags';
    const response = await call('PUT', path, { tagIds: [t.id, t.id] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: 'a', tags: [{ id: t.id }] } });
    const listed = await (await call('GET', '/api/line-accounts')).json<{ data: Array<Record<string, unknown>> }>();
    expect(listed.data.find(x => x.id === 'a')).toMatchObject({ name: '本店', tags: [{ id: t.id }], stats: { staffCount: 0 } });
    expect(listed.data.find(x => x.id === 'b')).toMatchObject({ tags: [] });
    expect(listed.data.some(x => x.id === 'other')).toBe(false);
    expect((await call('PUT', path, { tagIds: [] })).status).toBe(200);
    expect(db.raw.prepare('SELECT COUNT(*) AS c FROM line_account_tag_links').get()).toEqual({ c: 0 });
  });
  it('タグを消しても、アーカイブ済みを含むアカウントは消えない', async () => {
    const t = await tag();
    await call('PUT', '/api/line-accounts/a/tags', { tagIds: [t.id] });
    db.raw.prepare("UPDATE line_accounts SET archived_at = '2026-10-02' WHERE id = 'a'").run();
    expect((await call('DELETE', `/api/line-account-tags/${t.id}`)).status).toBe(200);
    expect(db.raw.prepare("SELECT id FROM line_accounts WHERE id = 'a'").get()).toEqual({ id: 'a' });
    expect(db.raw.prepare('SELECT COUNT(*) AS c FROM line_account_tag_links').get()).toEqual({ c: 0 });
  });
  it('別統括のタグとアカウントを読み書きできない', async () => {
    const own = await tag();
    staff.tenantId = 'tenant-other';
    const other = await tag('別のタグ');
    expect((await call('PATCH', `/api/line-account-tags/${own.id}`, { name: '変更' })).status).toBe(404);
    expect((await call('DELETE', `/api/line-account-tags/${own.id}`)).status).toBe(404);
    expect((await call('PUT', '/api/line-accounts/other/tags', { tagIds: [own.id] })).status).toBe(400);
    expect((await call('PUT', '/api/line-accounts/a/tags', { tagIds: [other.id] })).status).toBe(404);
    expect(await (await call('GET', '/api/line-account-tags')).json()).toMatchObject({ data: [{ id: other.id }] });
  });
  it('権限がない人と閲覧専用の人には全操作を403にする', async () => {
    const t = await tag();
    for (const props of [{ role: 'staff' as const, readOnly: false }, { role: 'admin' as const, readOnly: true }]) {
      Object.assign(staff, props);
      for (const [method, path, body] of [
        ['GET', '/api/line-account-tags', undefined], ['POST', '/api/line-account-tags', { name: '追加' }],
        ['PATCH', `/api/line-account-tags/${t.id}`, { name: '変更' }], ['DELETE', `/api/line-account-tags/${t.id}`, undefined],
        ['PUT', '/api/line-accounts/a/tags', { tagIds: [t.id] }],
      ] as const) expect((await call(method, path, body)).status).toBe(403);
    }
  });
  it('アーカイブ済みの付け外しは409にし、DBの一括更新でも触らない', async () => {
    const t = await tag();
    await call('PUT', '/api/line-accounts/a/tags', { tagIds: [t.id] });
    db.raw.prepare("UPDATE line_accounts SET archived_at = '2026-10-02' WHERE id = 'a'").run();
    expect((await call('PUT', '/api/line-accounts/a/tags', { tagIds: [] })).status).toBe(409);
    expect(await replaceLineAccountTags(db.db, DEFAULT_TENANT_ID, 'a', [])).toBe(false);
    expect(db.raw.prepare('SELECT tag_id FROM line_account_tag_links').all()).toEqual([{ tag_id: t.id }]);
  });
  it('名前・色・並び順・タグIDの不正入力を保存しない', async () => {
    for (const body of [{ name: '' }, { name: 'x', color: 'red' }, { name: 'x', displayOrder: -1 }, { name: 'x', displayOrder: 1.5 }])
      expect((await call('POST', '/api/line-account-tags', body)).status).toBe(400);
    for (const tagIds of [null, 'x', [3], ['missing']])
      expect((await call('PUT', '/api/line-accounts/a/tags', { tagIds })).status).toBe(400);
  });
  it('DB制約も統括違いのリンクを拒否する', async () => {
    const t = await tag();
    expect(() => db.raw.prepare('INSERT INTO line_account_tag_links (line_account_id, tag_id, tenant_id) VALUES (?, ?, ?)')
      .run('other', t.id, DEFAULT_TENANT_ID)).toThrow('ACCOUNT_TAG_SCOPE_INVALID');
  });
});
