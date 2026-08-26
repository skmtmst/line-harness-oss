import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { commonActions } from './common-actions';

function setupApp(db: D1Database, staff: AuthenticatedStaff) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  app.route('/', commonActions);
  return app;
}

const action = [{
  id: 'wait', type: 'wait', params: { minutes: 5 }, onFailure: 'stop',
}];

describe('V6共通アクションAPI', () => {
  let testDb: SqliteD1;
  const admin: AuthenticatedStaff = {
    id: 'admin-1', name: '管理者', role: 'admin', readOnly: false, tenantId: 'tenant-1',
  };

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, 'tenant-1')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-2', 'channel-2', '店舗2', '', '', 1, 'tenant-2')`,
    ).run();
  });

  it('アカウント指定なしを既定店舗へ黙って保存しない', async () => {
    const response = await setupApp(testDb.db, admin).request('/api/common-actions');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it('別統括のアカウントは存在も明かさない', async () => {
    const response = await setupApp(testDb.db, admin)
      .request('/api/common-actions?account_id=account-2');
    expect(response.status).toBe(404);
  });

  it('担当者は一覧を見られるが作成できない', async () => {
    const staff: AuthenticatedStaff = {
      ...admin, id: 'staff-1', role: 'staff', name: '担当者',
    };
    const app = setupApp(testDb.db, staff);
    expect((await app.request('/api/common-actions?account_id=account-1')).status).toBe(200);
    const response = await app.request('/api/common-actions?account_id=account-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '担当者作成', actions: action }),
    });
    expect(response.status).toBe(403);
  });

  it('管理者は選択中アカウントへ下書きを作成できる', async () => {
    const response = await setupApp(testDb.db, admin)
      .request('/api/common-actions?account_id=account-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '5分待つ', actions: action }),
      });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { versionNumber: 1 },
    });
    expect(testDb.raw.prepare(
      `SELECT line_account_id, status FROM common_actions`,
    ).get()).toEqual({ line_account_id: 'account-1', status: 'draft' });
  });
});
