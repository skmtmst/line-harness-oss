import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { tags } from './tags';

const admin: AuthenticatedStaff = {
  id: 'admin-1',
  name: '管理者',
  role: 'admin',
  readOnly: false,
  tenantId: 'tenant-1',
};

function app(db: D1Database, staff: AuthenticatedStaff = admin) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', tags);
  return instance;
}

function json(method: string, body: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('V6 タグ定義と共通アクション連動', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`).run();
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

  it('タグと連動下書きを1回の保存で作り、設定を読み戻す', async () => {
    const response = await app(testDb.db).request('/api/tags', json('POST', {
      lineAccountId: 'account-1',
      name: ' ＮＥＮ会員 ',
      description: '定期会員',
      reapplyPolicy: 'every_time',
      linkedEnabled: true,
      mileage: { self: 10, referrer: 5, multiplier: 15000, priority: 3 },
      automationDraft: {
        actions: [{
          id: 'welcome',
          type: 'send_message',
          params: { content: 'ありがとうございます' },
          onFailure: 'stop',
        }],
      },
      applyToExisting: false,
    }));

    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: {
        id: string;
        tag: { id: string; version: number; reapplyPolicy: string };
        automation: { id: string; draftVersion: { id: string; actions: unknown[] } };
      };
    };
    expect(body.data.id).toBe(body.data.tag.id);
    expect(body.data.tag).toMatchObject({ version: 1, reapplyPolicy: 'every_time' });
    expect(body.data.automation.draftVersion.actions).toHaveLength(1);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM tags`).get()).toEqual({ count: 1 });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM common_actions`).get()).toEqual({ count: 1 });
    expect(testDb.raw.prepare(
      `SELECT consumer_type, consumer_path FROM common_action_bindings`,
    ).get()).toEqual({ consumer_type: 'tag', consumer_path: 'tag.added' });

    const detail = await app(testDb.db).request(
      `/api/tags/${body.data.tag.id}?lineAccountId=account-1&withActions=1`,
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      data: {
        tag: { name: 'ＮＥＮ会員', linkedEnabled: true, version: 1 },
        automation: { id: body.data.automation.id },
      },
    });
  });

  it('版が一致するとタグと同じ共通アクション下書きを連動更新する', async () => {
    const created = await app(testDb.db).request('/api/tags', json('POST', {
      lineAccountId: 'account-1',
      name: '会員',
      linkedEnabled: true,
      mileage: { self: 0, referrer: 0, multiplier: null, priority: 0 },
      automationDraft: {
        actions: [{ id: 'old', type: 'send_message', params: { content: '旧' }, onFailure: 'stop' }],
      },
    }));
    const first = await created.json() as {
      data: { tag: { id: string }; automation: { id: string; draftVersion: { id: string } } };
    };

    const updated = await app(testDb.db).request(`/api/tags/${first.data.tag.id}`, json('PATCH', {
      lineAccountId: 'account-1',
      expectedVersion: 1,
      name: '継続会員',
      automationId: first.data.automation.id,
      automationDraftVersion: first.data.automation.draftVersion.id,
      actions: [{ id: 'new', type: 'add_tag', params: { tagId: first.data.tag.id }, onFailure: 'continue' }],
    }));

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        tag: { name: '継続会員', version: 2 },
        automation: { actions: [{ id: 'new', type: 'add_tag' }] },
      },
    });
  });

  it('古いタグ版・古い連動版は409にして片方だけ保存しない', async () => {
    const created = await app(testDb.db).request('/api/tags', json('POST', {
      lineAccountId: 'account-1',
      name: '競合確認',
      mileage: { self: 0, referrer: 0, multiplier: null, priority: 0 },
    }));
    const body = await created.json() as { data: { tag: { id: string } } };
    const conflict = await app(testDb.db).request(`/api/tags/${body.data.tag.id}`, json('PATCH', {
      lineAccountId: 'account-1',
      expectedVersion: 99,
      name: '上書きしない',
    }));
    expect(conflict.status).toBe(409);
    expect(testDb.raw.prepare(`SELECT name, version FROM tags WHERE id = ?`)
      .get(body.data.tag.id)).toEqual({ name: '競合確認', version: 1 });
  });

  it('別統括のアカウントと存在しないタグは404で存在を明かさない', async () => {
    const crossAccount = await app(testDb.db).request('/api/tags', json('POST', {
      lineAccountId: 'account-2',
      name: '見せない',
      mileage: { self: 0, referrer: 0, multiplier: null, priority: 0 },
    }));
    expect(crossAccount.status).toBe(404);

    const missing = await app(testDb.db).request(
      '/api/tags/not-found?lineAccountId=account-1&withActions=1',
    );
    expect(missing.status).toBe(404);
  });

  it('別アカウントの連動先を下書きにも保存しない', async () => {
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id) VALUES ('foreign-tag', '別店舗', 'account-2')`,
    ).run();
    const response = await app(testDb.db).request('/api/tags', json('POST', {
      lineAccountId: 'account-1',
      name: '範囲確認',
      linkedEnabled: true,
      mileage: { self: 0, referrer: 0, multiplier: null, priority: 0 },
      automationDraft: {
        actions: [{
          id: 'foreign',
          type: 'add_tag',
          params: { tagId: 'foreign-tag' },
          onFailure: 'stop',
        }],
      },
    }));
    expect(response.status).toBe(422);
    expect(testDb.raw.prepare(`SELECT id FROM tags WHERE name = '範囲確認'`).get()).toBeUndefined();
  });

  it('削除影響は明細・連動・マイル・版を同じrevisionで返す', async () => {
    const created = await app(testDb.db).request('/api/tags', json('POST', {
      lineAccountId: 'account-1',
      name: '影響あり',
      linkedEnabled: true,
      mileage: { self: 10, referrer: 5, multiplier: 15000, priority: 3 },
      automationDraft: {
        actions: [{ id: 'message', type: 'send_message', params: { content: '案内' }, onFailure: 'stop' }],
      },
    }));
    const body = await created.json() as { data: { tag: { id: string } } };
    const impact = await app(testDb.db).request(
      `/api/tags/${body.data.tag.id}/dependencies?lineAccountId=account-1`,
    );
    expect(impact.status).toBe(200);
    await expect(impact.json()).resolves.toMatchObject({
      data: {
        tag: { version: 1 },
        references: [],
        linkedActions: [{ state: 'draft' }],
        pendingRunCount: 0,
        mileageImpact: { configured: true, self: 10, historyPreserved: true },
        canArchive: true,
        canDelete: false,
      },
    });
  });

  it('影響revisionと版が一致すると、付与と履歴を残してタグを保管する', async () => {
    const created = await app(testDb.db).request('/api/tags', json('POST', {
      lineAccountId: 'account-1',
      name: '保管するタグ',
      mileage: { self: 0, referrer: 0, multiplier: null, priority: 0 },
    }));
    const createdBody = await created.json() as { data: { tag: { id: string; version: number } } };
    const impactResponse = await app(testDb.db).request(
      `/api/tags/${createdBody.data.tag.id}/dependencies?lineAccountId=account-1`,
    );
    const impactBody = await impactResponse.json() as { data: { revision: string } };

    const archived = await app(testDb.db).request(
      `/api/tags/${createdBody.data.tag.id}/archive?lineAccountId=account-1`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'archive-tag-test-1' },
        body: JSON.stringify({
          expectedVersion: createdBody.data.tag.version,
          impactRevision: impactBody.data.revision,
        }),
      },
    );
    expect(archived.status).toBe(200);
    await expect(archived.json()).resolves.toMatchObject({
      data: { archived: true, replacedFriendCount: 0 },
    });
    expect(testDb.raw.prepare('SELECT status, version FROM tags WHERE id = ?')
      .get(createdBody.data.tag.id)).toEqual({ status: 'archived', version: 2 });
    expect(testDb.raw.prepare(
      "SELECT action FROM operation_audit WHERE target_kind = 'tag' AND target_id = ?",
    ).get(createdBody.data.tag.id)).toEqual({ action: 'archived' });
  });

  it('閲覧担当者は作成・更新・依存確認を行えない', async () => {
    const staff: AuthenticatedStaff = { ...admin, id: 'staff-1', role: 'staff', name: '担当者' };
    const instance = app(testDb.db, staff);
    expect((await instance.request('/api/tags', json('POST', {
      lineAccountId: 'account-1',
      name: '作れない',
      mileage: { self: 0, referrer: 0, multiplier: null, priority: 0 },
    }))).status).toBe(403);
    expect((await instance.request('/api/tags/id', json('PATCH', {
      lineAccountId: 'account-1', expectedVersion: 1, name: '変えられない',
    }))).status).toBe(403);
    expect((await instance.request(
      '/api/tags/id/dependencies?lineAccountId=account-1',
    )).status).toBe(403);
  });
});
