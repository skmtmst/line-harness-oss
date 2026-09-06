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

  it('一覧はページ情報を返し、CSVは担当者の個別権限を再確認する', async () => {
    const adminApp = setupApp(testDb.db, admin);
    for (const name of ['先に作成', 'あとに作成']) {
      const response = await adminApp.request('/api/common-actions?account_id=account-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, actions: action }),
      });
      expect(response.status).toBe(201);
    }
    const page = await adminApp.request('/api/common-actions?account_id=account-1&limit=1&offset=1');
    expect(page.status).toBe(200);
    await expect(page.json()).resolves.toMatchObject({
      success: true,
      data: [{ name: '先に作成', executionCountThisMonth: 0, failureCountThisMonth: 0, lastRunAt: null }],
      pagination: { total: 2, limit: 1, offset: 1 },
      freshness: 'available',
    });

    const staff: AuthenticatedStaff = {
      ...admin, id: 'staff-1', name: '担当者', role: 'staff', permissionKeys: [],
    };
    const denied = await setupApp(testDb.db, staff)
      .request('/api/common-actions?account_id=account-1&format=csv');
    expect(denied.status).toBe(403);
    const csv = await setupApp(testDb.db, {
      ...staff, permissionKeys: ['automation.run.export'],
    }).request('/api/common-actions?account_id=account-1&format=csv');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('今月の実行');
  });

  it('タグ付与の連動ドロワーへ13種類のschemaと範囲内選択肢を返す', async () => {
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id) VALUES ('tag-2', '別統括', 'account-2')`,
    ).run();
    const response = await setupApp(testDb.db, admin).request(
      '/api/common-actions/resources?lineAccountId=account-1&trigger=tag.added',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        trigger: string;
        actionTypes: Array<{ id: string; schema: { type: string } }>;
        tags: Array<{ id: string }>;
      };
    };
    expect(body.data.trigger).toBe('tag.added');
    expect(body.data.actionTypes).toHaveLength(13);
    expect(body.data.actionTypes.every((item) => item.schema.type === 'object')).toBe(true);
    expect(body.data.tags).toEqual([{ id: 'tag-1', name: '会員' }]);
  });
});
