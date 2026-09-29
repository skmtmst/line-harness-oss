/* N-175 直接試験: 実route＋実SQLite。folderId条件をサーバーで絞ること。 */
import { Hono } from 'hono';
import { expect, test } from 'vitest';

const { createTestD1 } = await import('../test-utils/d1-sqlite.js');
const { forms } = await import('./forms.js');
const { authMiddleware } = await import('../middleware/auth.js');
const { DEFAULT_TENANT_ID } = await import('@line-crm/shared');

const TENANT_B = 'tenant-B';

function setup() {
  const t = createTestD1();
  const raw = t.raw;
  raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?), (?, ?)')
    .run(DEFAULT_TENANT_ID, '既定', TENANT_B, '支社');
  for (const [id, tenant] of [['acc-a', DEFAULT_TENANT_ID], ['acc-b', DEFAULT_TENANT_ID], ['acc-t2', TENANT_B]] as const) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 't', 's', 1, ?)`,
    ).run(id, `ch-${id}`, id, tenant);
  }
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
     VALUES ('owner-1', 'o', 'owner', 'full', 'key-owner', '[]', 'all', ?)`,
  ).run(DEFAULT_TENANT_ID);
  raw.prepare(
    `INSERT INTO folders (id, kind, name, account_id) VALUES
       ('fol-a', 'form', 'A箱', 'acc-a'),
       ('fol-b', 'form', 'B箱', 'acc-b'),
       ('fol-tag', 'tag', 'タグ箱', 'acc-a')`,
  ).run();
  const form = (id: string, folder: string | null, account: string) => {
    raw.prepare(`INSERT INTO forms (id, name, fields, folder_id) VALUES (?, ?, '[]', ?)`).run(id, id, folder);
    raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES (?, ?)`).run(id, account);
  };
  form('f-a1', 'fol-a', 'acc-a');
  form('f-a2', null, 'acc-a');
  form('f-b1', 'fol-b', 'acc-b');

  const app = new Hono<any>();
  app.use('*', authMiddleware);
  app.route('/', forms);
  const env = { DB: t.db } as any;
  const get = (path: string): Response | Promise<Response> =>
    app.request(path, { headers: { Authorization: 'Bearer key-owner' } }, env);
  return { t, get };
}

test('N-175 フォルダ指定はサーバーで絞り、件数も一致する', async () => {
  const { t, get } = setup();
  const r = await get('/api/forms?account_id=acc-a&folder_id=fol-a&with_list_summary=1');
  expect(r.status).toBe(200);
  const body = (await r.json()) as any;
  expect(body.data.items.map((f: any) => f.id)).toEqual(['f-a1']);
  expect(body.data.total).toBe(1);
  t.raw.close();
});

test('N-175 未分類はfolderなしだけ返す', async () => {
  const { t, get } = setup();
  const r = await get('/api/forms?account_id=acc-a&folder_id=unfiled');
  expect(r.status).toBe(200);
  expect(((await r.json()) as any).data.map((f: any) => f.id)).toEqual(['f-a2']);
  t.raw.close();
});

test('N-175 異種別・存在なしはfail-closed、他accountの箱は漏らさない', async () => {
  const { t, get } = setup();
  expect((await get('/api/forms?account_id=acc-a&folder_id=fol-tag')).status).toBe(404);
  expect((await get('/api/forms?account_id=acc-a&folder_id=ghost')).status).toBe(404);
  const other = await get('/api/forms?account_id=acc-a&folder_id=fol-b');
  expect(other.status).toBe(200);
  expect(((await other.json()) as any).data).toEqual([]);
  t.raw.close();
});
