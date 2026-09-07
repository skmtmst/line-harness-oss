import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { automations } from './automations';

function app(db: D1Database, staff: AuthenticatedStaff) {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  hono.route('/', automations);
  return hono;
}

describe('オートメーション下書きAPI', () => {
  let testDb: SqliteD1;
  const admin: AuthenticatedStaff = {
    id: 'admin-1',
    name: '管理者',
    role: 'admin',
    readOnly: false,
    tenantId: 'tenant-1',
    permissionKeys: [],
  };

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')").run();
    testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')").run();
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

  it('担当者の/automations権限をWorkerで再確認する', async () => {
    const staff: AuthenticatedStaff = {
      ...admin,
      id: 'staff-1',
      name: '担当者',
      role: 'staff',
    };
    const denied = await app(testDb.db, staff)
      .request('/api/automation-templates?account_id=account-1');
    expect(denied.status).toBe(403);

    const allowed = await app(testDb.db, { ...staff, permissionKeys: ['/automations'] })
      .request('/api/automation-templates?account_id=account-1');
    expect(allowed.status).toBe(200);
  });

  it('担当者は見本を見られても下書きを作成できない', async () => {
    const response = await app(testDb.db, {
      ...admin,
      id: 'staff-1',
      name: '担当者',
      role: 'staff',
      permissionKeys: ['/automations'],
    }).request('/api/automation-templates/welcome-scenario/drafts?account_id=account-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
  });

  it('1人テストは閲覧権限と実行権限を別々に再確認する', async () => {
    const staff: AuthenticatedStaff = {
      ...admin,
      id: 'staff-1',
      name: '担当者',
      role: 'staff',
      permissionKeys: ['/automations'],
    };
    const denied = await app(testDb.db, staff).request(
      '/api/automations/missing/test?account_id=account-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(denied.status).toBe(403);

    const allowed = await app(testDb.db, {
      ...staff,
      permissionKeys: ['/automations', 'automation.definition.test'],
    }).request(
      '/api/automations/missing/test?account_id=account-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(allowed.status).toBe(422);
  });

  it('管理者は選択中アカウントに非公開の下書きを作成して取得できる', async () => {
    const adminApp = app(testDb.db, admin);
    const created = await adminApp.request(
      '/api/automation-templates/welcome-scenario/drafts?account_id=account-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      data: { id: string; draftVersionId: string };
    };

    const fetched = await adminApp.request(
      `/api/automation-drafts/${createdBody.data.id}?account_id=account-1`,
    );
    expect(fetched.status).toBe(200);
    await expect(fetched.json()).resolves.toMatchObject({
      success: true,
      data: {
        id: createdBody.data.id,
        draftVersionId: createdBody.data.draftVersionId,
        eventType: 'friend_add',
      },
    });
    expect(testDb.raw.prepare(
      'SELECT line_account_id, status, current_published_version_id, created_by FROM automation_definitions',
    ).get()).toEqual({
      line_account_id: 'account-1',
      status: 'draft',
      current_published_version_id: null,
      created_by: 'admin-1',
    });
  });

  it('接続済みのイベント・日時きっかけだけを下書きへ保存する', async () => {
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO friends
         (id, line_user_id, display_name, line_account_id, metadata, created_at, updated_at)
       VALUES ('friend-1', 'U-friend-1', '田中さん', 'account-1', '{}', datetime('now'), datetime('now'))`,
    ).run();
    const adminApp = app(testDb.db, admin);
    const created = await adminApp.request(
      '/api/automation-templates/welcome-scenario/drafts?account_id=account-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    const createdBody = await created.json() as { data: { id: string; draftVersionId: string } };
    const cases: Array<[string, Record<string, unknown>]> = [
      ['form_submitted', {}],
      ['link_clicked', {}],
      ['calendar_booked', {}],
      ['datetime', { at: '2099-01-01T09:00:00+09:00', friendIds: ['friend-1'] }],
      ['daily', { time: '09:00', friendIds: ['friend-1'] }],
      ['weekly', { time: '09:00', weekdays: [1, 3], friendIds: ['friend-1'] }],
    ];
    for (const [eventType, triggerConfig] of cases) {
      const response = await adminApp.request(
        `/api/automation-drafts/${createdBody.data.id}?account_id=account-1`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedDraftVersionId: createdBody.data.draftVersionId,
            name: '接続済みきっかけ',
            eventType,
            triggerConfig,
            conditions: { operator: 'AND', rules: [{ type: 'is_following', value: true }] },
            actions: [{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }],
          }),
        },
      );
      expect(response.status, eventType).toBe(200);
      expect(testDb.raw.prepare(
        `SELECT trigger_type FROM automation_versions WHERE id = ?`,
      ).get(createdBody.data.draftVersionId)).toEqual({ trigger_type: eventType });
    }
    const unsupported = await adminApp.request(
      `/api/automation-drafts/${createdBody.data.id}?account_id=account-1`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedDraftVersionId: createdBody.data.draftVersionId,
          name: '未接続', eventType: 'unfollow', triggerConfig: {},
          actions: [{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }],
        }),
      },
    );
    expect(unsupported.status).toBe(422);
    await expect(unsupported.json()).resolves.toMatchObject({ code: 'trigger_unsupported' });
  });

  it('複数の処理を保存し、確認した下書きだけを動作中として公開する', async () => {
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`,
    ).run();
    const adminApp = app(testDb.db, admin);
    const created = await adminApp.request(
      '/api/automation-templates/received-message-tag/drafts?account_id=account-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    const createdBody = await created.json() as { data: { id: string; draftVersionId: string } };
    const updated = await adminApp.request(
      `/api/automation-drafts/${createdBody.data.id}?account_id=account-1`,
      {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedDraftVersionId: createdBody.data.draftVersionId,
          name: '注文後の案内', eventType: 'ec.order.confirmed', triggerConfig: {}, conditions: {},
          actions: [
            { id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' },
            { id: 'message', type: 'send_message', params: { content: 'ありがとうございます' }, onFailure: 'stop' },
          ],
        }),
      },
    );
    expect(updated.status).toBe(200);
    const published = await adminApp.request(
      `/api/automation-drafts/${createdBody.data.id}/publish?account_id=account-1`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedDraftVersionId: createdBody.data.draftVersionId, activate: true }),
      },
    );
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({
      success: true,
      data: { id: createdBody.data.id, versionId: createdBody.data.draftVersionId, status: 'active' },
    });
    expect(testDb.raw.prepare(
      `SELECT status, current_draft_version_id, current_published_version_id
         FROM automation_definitions WHERE id = ?`,
    ).get(createdBody.data.id)).toEqual({
      status: 'active', current_draft_version_id: null,
      current_published_version_id: createdBody.data.draftVersionId,
    });
  });

  it('別統括のアカウントは存在も明かさない', async () => {
    const response = await app(testDb.db, admin)
      .request('/api/automation-templates/welcome-scenario/drafts?account_id=account-2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    expect(response.status).toBe(404);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_definitions').get())
      .toEqual({ count: 0 });
  });
});
