/*
 * 配信の作成・更新・送信の共通境界(N-061)。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物の broadcasts ルートを当てる。
 * 作成時は要求account、更新・送信時はDB行のaccountを共通土台へ渡す。
 *   - owner/adminは従来どおり通る（状態・文言を変えない）
 *   - /broadcasts持ちstaffだけが動き、別account・read-only・キーなしは拒否
 * 送信のキュー投入だけは止める（LINEへ出さない）。境界の判定は本物のまま通す。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

vi.mock('../services/broadcast.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/broadcast.js')>();
  return {
    ...actual,
    processQueuedBroadcasts: vi.fn().mockResolvedValue(undefined),
    processBroadcastSend: vi.fn().mockResolvedValue(undefined),
  };
});

const { broadcasts } = await import('./broadcasts.js');

let sqlite: SqliteD1;

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const keyStaff: AuthenticatedStaff = {
  id: 'staff-key', name: '配信権あり', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/broadcasts'],
};
const noKeyStaff: AuthenticatedStaff = {
  id: 'staff-none', name: '権限なし', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/scenarios'],
};
const readOnlyStaff: AuthenticatedStaff = {
  id: 'staff-ro', name: '読取専用', role: 'staff', readOnly: true, tenantId: 'tenant-1',
  permissionKeys: ['/broadcasts'],
};
const scopedStaff: AuthenticatedStaff = {
  id: 'staff-scoped', name: '店1だけ', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/broadcasts'],
};

function app(staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: sqlite.db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', broadcasts);
  return instance;
}

function postCreate(body: unknown, staff: AuthenticatedStaff = owner) {
  return app(staff).request('/api/broadcasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putUpdate(id: string, body: unknown, staff: AuthenticatedStaff = owner) {
  return app(staff).request(`/api/broadcasts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postSend(id: string, staff: AuthenticatedStaff = owner) {
  return app(staff).request(`/api/broadcasts/${id}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Confirm-Irreversible': 'broadcast-send' },
    body: JSON.stringify({}),
  });
}

function seed(): void {
  const raw = sqlite.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`).run();
  for (const [id, tenant] of [['acc-1', 'tenant-1'], ['acc-2', 'tenant-1'], ['acc-3', 'tenant-2']] as const) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
  const staffRows = [
    ['owner-1', 'オーナー', 'owner', 'key-owner', 'tenant-1', 'all', '[]'],
    ['staff-key', '配信権あり', 'staff', 'key-bc', 'tenant-1', 'all', '["/broadcasts"]'],
    ['staff-none', '権限なし', 'staff', 'key-none', 'tenant-1', 'all', '["/scenarios"]'],
    ['staff-ro', '読取専用', 'staff', 'key-ro', 'tenant-1', 'all', '["/broadcasts"]'],
    ['staff-scoped', '店1だけ', 'staff', 'key-scoped', 'tenant-1', 'accounts', '["/broadcasts"]'],
    ['owner-2', '統括2のオーナー', 'owner', 'key-owner-2', 'tenant-2', 'all', '[]'],
  ] as const;
  for (const [id, name, role, key, tenant, scope, keys] of staffRows) {
    raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, role, key, tenant, scope, keys);
  }
  raw.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('staff-scoped', 'acc-1', '2026-09-01T00:00:00.000Z')`,
  ).run();
}

function seedBroadcast(id: string, accountId: string | null, status = 'draft'): void {
  sqlite.raw.prepare(
    `INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
     VALUES (?, 'お知らせ', 'text', 'こんにちは', 'all', ?, ?)`,
  ).run(id, status, accountId);
}

function statusOf(id: string): string | null {
  const row = sqlite.raw.prepare(`SELECT status FROM broadcasts WHERE id = ?`).get(id) as { status: string } | undefined;
  return row?.status ?? null;
}

const CREATE_BODY = {
  title: 'お知らせ', messageType: 'text', messageContent: 'こんにちは',
  targetType: 'all', lineAccountId: 'acc-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = createTestD1();
  seed();
});

describe('配信の共通境界(N-061)', () => {
  test('作成は/broadcasts持ちstaffが要求accountへ作れる', async () => {
    const res = await postCreate(CREATE_BODY, keyStaff);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBeTruthy();
  });

  test('作成はキーなし・readOnly・担当外・別tenantに403', async () => {
    const denied = await postCreate(CREATE_BODY, noKeyStaff);
    expect(denied.status).toBe(403);
    const readOnly = await postCreate(CREATE_BODY, readOnlyStaff);
    expect(readOnly.status).toBe(403);
    const scoped = await postCreate({ ...CREATE_BODY, lineAccountId: 'acc-2' }, scopedStaff);
    expect(scoped.status).toBe(403);
    const otherTenantOwner: AuthenticatedStaff = {
      id: 'owner-2', name: '統括2', role: 'owner', readOnly: false, tenantId: 'tenant-2',
    };
    const crossTenant = await postCreate(CREATE_BODY, otherTenantOwner);
    expect(crossTenant.status).toBe(403);
  });

  test('更新は/broadcasts持ちstaffが自accountの行を変えられる', async () => {
    seedBroadcast('bc-1', 'acc-1');
    const res = await putUpdate('bc-1', { title: '新しい題名', expectedVersion: 1 }, keyStaff);
    expect(res.status).toBe(200);
  });

  test('更新はキーなしに403、担当外に404', async () => {
    seedBroadcast('bc-1', 'acc-1');
    seedBroadcast('bc-2', 'acc-2');
    const denied = await putUpdate('bc-1', { title: '書き換え', expectedVersion: 1 }, noKeyStaff);
    expect(denied.status).toBe(403);
    const hidden = await putUpdate('bc-2', { title: '書き換え', expectedVersion: 1 }, scopedStaff);
    expect(hidden.status).toBe(404);
  });

  test('送信は/broadcasts持ちstaffが自accountの行を送れる', async () => {
    seedBroadcast('bc-1', 'acc-1');
    const res = await postSend('bc-1', keyStaff);
    expect(res.status).toBe(200);
    expect(statusOf('bc-1')).toBe('sending');
  });

  test('送信はキーなし・readOnlyに403、担当外に404', async () => {
    seedBroadcast('bc-1', 'acc-1');
    seedBroadcast('bc-2', 'acc-2');
    expect((await postSend('bc-1', noKeyStaff)).status).toBe(403);
    expect((await postSend('bc-1', readOnlyStaff)).status).toBe(403);
    expect((await postSend('bc-2', scopedStaff)).status).toBe(404);
    expect(statusOf('bc-1')).not.toBe('sending');
    expect(statusOf('bc-2')).not.toBe('sending');
  });

  test('ownerは従来どおり作成・更新・送信できる', async () => {
    seedBroadcast('bc-1', 'acc-1');
    expect((await postCreate(CREATE_BODY, owner)).status).toBe(201);
    expect((await putUpdate('bc-1', { title: '題名', expectedVersion: 1 }, owner)).status).toBe(200);
    expect((await postSend('bc-1', owner)).status).toBe(200);
  });
});
