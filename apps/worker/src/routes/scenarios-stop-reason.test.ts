import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { scenarios } from './scenarios.js';

let sqlite: SqliteD1;
const editor: AuthenticatedStaff = {
  id: 'editor', name: '担当者', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/scenarios', 'scenario.definition.edit'],
};
function app(staff = editor) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: sqlite.db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', scenarios);
  return instance;
}
function put(body: unknown, staff = editor, id = 'sc-1') {
  return app(staff).request(`/api/scenarios/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function record() {
  return sqlite.raw.prepare('SELECT is_active, stopped_reason, stopped_by, stopped_at FROM scenarios WHERE id = ?').get('sc-1');
}
beforeEach(() => {
  sqlite = createTestD1();
  sqlite.raw.exec(`
    INSERT INTO tenants (id, name) VALUES ('tenant-1', '会社');
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('acc-1', 'channel-1', '本店', 'token', 'secret', 'tenant-1'), ('acc-2', 'channel-2', '支店', 'token', 'secret', 'tenant-1');
    INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
      VALUES ('editor', '担当者', 'staff', 'test-key', 'tenant-1', 'accounts', '["/scenarios","scenario.definition.edit"]');
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES ('editor', 'acc-1', '2026-10-07T00:00:00+09:00');
    INSERT INTO scenarios (id, name, trigger_type, line_account_id)
      VALUES ('sc-1', '配信', 'manual', 'acc-1'), ('sc-2', '担当外', 'manual', 'acc-2');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('friend-1', 'U1', '読者', 'acc-1');
    INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, next_delivery_at)
      VALUES ('sub-1', 'friend-1', 'sc-1', 2, 'active', '2026-10-08T20:00:00+09:00');
  `);
});
afterEach(() => sqlite.raw.close());

describe('シナリオを止める理由', () => {
  test('理由・操作した本人・日本時間を詳細で読み直せ、購読の途中の記録は残る', async () => {
    const response = await put({ isActive: false, reason: '2通目の画像を差し替えるため', stoppedBy: '偽の担当者' });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ isActive: false, stoppedReason: '2通目の画像を差し替えるため', stoppedBy: 'editor' });
    expect(body.data.stoppedAt).toMatch(/\+09:00$/);
    const detail = await app().request('/api/scenarios/sc-1');
    expect(detail.status).toBe(200);
    expect((await detail.json() as { data: unknown }).data).toMatchObject({ ...body.data, steps: [] });
    expect(sqlite.raw.prepare('SELECT current_step_order, status, next_delivery_at FROM friend_scenarios').get())
      .toEqual({ current_step_order: 2, status: 'active', next_delivery_at: '2026-10-08T20:00:00+09:00' });
  });

  test.each([undefined, '', '   '])('理由が%jでも従来どおり止められる', async (reason) => {
    const response = await put({ isActive: false, reason });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: unknown }).data).toMatchObject({ isActive: false, stoppedReason: null, stoppedBy: 'editor' });
  });

  test.each(['あ'.repeat(200), '😀'.repeat(200)])('200字の理由を保存できる', async (reason) => {
    const response = await put({ isActive: false, reason });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { stoppedReason: string } }).data.stoppedReason).toBe(reason);
  });

  test.each(['あ'.repeat(201), '😀'.repeat(201), null, 123, {}, []])('不正な理由は400で配信と記録を変えない', async (reason) => {
    const before = record();
    expect((await put({ isActive: false, reason })).status).toBe(400);
    expect(record()).toEqual(before);
  });

  test.each([{ reason: '編集' }, { isActive: true, reason: '再開' }, { isActive: 'false' }])('停止以外の理由・不正な状態入力を拒む', async (body) => {
    const before = record();
    expect((await put(body)).status).toBe(400);
    expect(record()).toEqual(before);
  });

  test('停止記録の無い詳細はnullを返す', async () => {
    const detail = await app().request('/api/scenarios/sc-1');
    expect(detail.status).toBe(200);
    expect((await detail.json() as { data: unknown }).data).toMatchObject({ stoppedReason: null, stoppedBy: null, stoppedAt: null });
  });

  test('再試行・編集・再開は記録を消さず、次の停止は理由を更新する', async () => {
    expect((await put({ isActive: false, reason: '最初' })).status).toBe(200);
    const first = record();
    expect((await put({ isActive: false, reason: '二重クリック' })).status).toBe(200);
    expect(record()).toEqual(first);
    expect((await put({ name: '名前だけ' })).status).toBe(200);
    expect(record()).toEqual(first);
    expect((await put({ isActive: true })).status).toBe(200);
    expect(record()).toEqual({ ...(first as object), is_active: 1 });
    expect((await put({ isActive: false, reason: '次の停止' })).status).toBe(200);
    expect(record()).toMatchObject({ stopped_reason: '次の停止', stopped_by: 'editor' });
  });

  test('閲覧だけ・読み取り専用・担当外では停止も記録もできない', async () => {
    const before = record();
    expect((await put({ isActive: false, reason: '停止' }, { ...editor, permissionKeys: ['/scenarios'] })).status).toBe(403);
    expect((await put({ isActive: false, reason: '停止' }, { ...editor, readOnly: true })).status).toBe(403);
    expect((await put({ isActive: false, reason: '停止' }, editor, 'sc-2')).status).toBe(404);
    expect((await app().request('/api/scenarios/sc-2')).status).toBe(404);
    expect((await put({ isActive: false }, editor, 'missing')).status).toBe(404);
    expect(record()).toEqual(before);
    expect(sqlite.raw.prepare('SELECT is_active, stopped_at FROM scenarios WHERE id = ?').get('sc-2')).toEqual({ is_active: 1, stopped_at: null });
  });
});
