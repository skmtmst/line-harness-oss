/* N-170 直接試験: 実route＋実SQLite。/form-submissions 鍵のstaffが操作できること。 */
import { Hono } from 'hono';
import { expect, test } from 'vitest';

const { createTestD1 } = await import('../test-utils/d1-sqlite.js');
const { forms } = await import('./forms.js');
const { authMiddleware } = await import('../middleware/auth.js');
const { DEFAULT_TENANT_ID } = await import('@line-crm/shared');

const TENANT_B = 'tenant-B';
const KEY = '/form-submissions';

function setup() {
  const t = createTestD1();
  const raw = t.raw;
  raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?), (?, ?)')
    .run(DEFAULT_TENANT_ID, '既定', TENANT_B, '支社');
  for (const [id, tenant] of [['acc-a', DEFAULT_TENANT_ID], ['acc-a2', DEFAULT_TENANT_ID], ['acc-t2', TENANT_B]] as const) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 't', 's', 1, ?)`,
    ).run(id, `ch-${id}`, id, tenant);
  }
  const staff = (id: string, role: string, access: string, key: string, keys: string | null, scope: string, tenant: string) => {
    raw.prepare(
      `INSERT INTO staff_members (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, id, role, access, key, keys ?? '[]', scope, tenant);
  };
  staff('owner-1', 'owner', 'full', 'key-owner', null, 'all', DEFAULT_TENANT_ID);
  staff('staff-1', 'staff', 'full', 'key-staff', JSON.stringify([KEY]), 'all', DEFAULT_TENANT_ID);
  staff('staff-nokey', 'staff', 'full', 'key-nokey', null, 'all', DEFAULT_TENANT_ID);
  staff('staff-ro', 'staff', 'read_only', 'key-ro', JSON.stringify([KEY]), 'all', DEFAULT_TENANT_ID);
  staff('scoped-1', 'staff', 'full', 'key-scoped', JSON.stringify([KEY]), 'accounts', DEFAULT_TENANT_ID);
  raw.prepare(`INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES ('scoped-1', 'acc-a', '2026-09-14T00:00:00+09:00')`).run();

  const app = new Hono<any>();
  app.use('*', authMiddleware);
  app.route('/', forms);
  const env = { DB: t.db } as any;
  const req = async (path: string, key: string, init?: RequestInit): Promise<Response> =>
    app.request(path, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init?.headers ?? {}) } }, env);
  const J = { 'content-type': 'application/json' };
  return { t, raw, req, J };
}

async function createAs(req: any, J: any, key: string, accountId: string, name = '申込') {
  const r = await req(`/api/forms?accountId=${accountId}`, key, {
    method: 'POST', headers: J, body: JSON.stringify({ name, accountId }),
  });
  return r;
}

test('N-170 鍵持ちstaffは作成・下書き・更新・公開ができる', async () => {
  const { t, req, J } = setup();
  const created = await createAs(req, J, 'key-staff', 'acc-a');
  expect(created.status).toBe(201);
  const id = ((await created.json()) as any).data.id as string;
  const drafts = await req('/api/forms/drafts', 'key-staff', {
    method: 'POST', headers: J, body: JSON.stringify({ accountId: 'acc-a' }),
  });
  expect(drafts.status).toBe(201);
  const put = await req(`/api/forms/${id}?account_id=acc-a`, 'key-staff', {
    method: 'PUT', headers: J, body: JSON.stringify({ name: '申込2', expectedContentRevision: 1 }),
  });
  expect(put.status).toBe(200);
  const pub = await req(`/api/forms/${id}/publish?account_id=acc-a`, 'key-staff', {
    method: 'POST', headers: J, body: JSON.stringify({ expectedContentRevision: 2 }),
  });
  expect(pub.status).toBe(200);
  t.raw.close();
});

test('N-170 鍵なし・readOnlyは止まり、owner互換は保つ', async () => {
  const { t, req, J } = setup();
  const denied = await createAs(req, J, 'key-nokey', 'acc-a');
  expect(denied.status).toBe(403);
  const ro = await createAs(req, J, 'key-ro', 'acc-a');
  expect(ro.status).toBe(403);
  const owner = await createAs(req, J, 'key-owner', 'acc-a');
  expect(owner.status).toBe(201);
  t.raw.close();
});

test('N-170 別tenant・別account・担当外は混ぜない', async () => {
  const { t, req, J } = setup();
  expect((await createAs(req, J, 'key-staff', 'acc-t2')).status).toBe(404);
  expect((await createAs(req, J, 'key-staff', 'acc-a2')).status).toBe(201);
  const created = await createAs(req, J, 'key-owner', 'acc-a2');
  const id = ((await created.json()) as any).data.id as string;
  const scoped = await req(`/api/forms/${id}?account_id=acc-a2`, 'key-scoped', {
    method: 'PUT', headers: J, body: JSON.stringify({ name: 'x', expectedContentRevision: 1 }),
  });
  expect(scoped.status).toBe(404);
  t.raw.close();
});

test('N-170 複数accountのフォームは全所属を扱える人だけ更新できる', async () => {
  const { t, raw, req, J } = setup();
  const created = await createAs(req, J, 'key-owner', 'acc-a');
  const id = ((await created.json()) as any).data.id as string;
  raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES (?, 'acc-a2')`).run(id);
  const scoped = await req(`/api/forms/${id}?account_id=acc-a`, 'key-scoped', {
    method: 'PUT', headers: J, body: JSON.stringify({ name: 'x', expectedContentRevision: 1 }),
  });
  expect(scoped.status).toBe(404);
  const all = await req(`/api/forms/${id}?account_id=acc-a`, 'key-staff', {
    method: 'PUT', headers: J, body: JSON.stringify({ name: 'y', expectedContentRevision: 1 }),
  });
  expect(all.status).toBe(200);
  t.raw.close();
});

test('N-170 未割当legacyの更新は鍵持ちstaffに許可しない', async () => {
  const { t, raw, req, J } = setup();
  raw.prepare(`INSERT INTO forms (id, name, fields) VALUES ('legacy-1', '旧', '[]')`).run();
  const r = await req('/api/forms/legacy-1?account_id=acc-a', 'key-staff', {
    method: 'PUT', headers: J, body: JSON.stringify({ name: 'x', expectedContentRevision: 1 }),
  });
  expect(r.status).toBe(404);
  t.raw.close();
});
