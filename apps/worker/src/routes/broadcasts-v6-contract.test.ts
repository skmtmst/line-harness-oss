import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite';
import { broadcasts } from './broadcasts';

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const staff: AuthenticatedStaff = {
  ...owner, id: 'staff-1', name: '担当者', role: 'staff', permissionKeys: ['/broadcasts'],
};

function app(db: D1Database, actor: AuthenticatedStaff = owner) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'default-token', WORKER_URL: 'https://worker.example' } as Env['Bindings'];
    c.set('staff', actor);
    await next();
  });
  instance.route('/', broadcasts);
  return instance;
}

function json(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function seedBroadcast(db: SqliteD1, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    title: id,
    message_type: 'text',
    message_content: 'https://example.com/campaign',
    target_type: 'all',
    status: 'sent',
    total_count: 10,
    success_count: 10,
    line_account_id: 'account-1',
    sent_at: '2026-09-07T10:00:00.000Z',
    created_at: '2026-09-07T09:00:00.000Z',
    ...overrides,
  };
  const columns = Object.keys(row);
  db.raw.prepare(
    `INSERT INTO broadcasts (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map((column) => row[column] as never));
}

describe('V6 broadcast data contracts', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2')").run();
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
      VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1'),
             ('account-2', 'channel-2', '店舗2', 'token-2', 'secret-2', 1, 'tenant-2')
    `).run();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/quota/consumption')) return Response.json({ totalUsage: 1213 });
      if (url.endsWith('/quota')) return Response.json({ type: 'limited', value: 5000 });
      return new Response(null, { status: 404 });
    }));
  });

  afterEach(() => {
    testDb.raw.close();
    vi.unstubAllGlobals();
  });

  it('更新口もLINE送信口と同じ最大5通を受け、6通目を拒否する', async () => {
    seedBroadcast(testDb, 'draft-five', { status: 'draft', sent_at: null });
    const bubbles = Array.from({ length: 5 }, (_, index) => ({
      id: `bubble-${index + 1}`,
      type: 'text',
      content: { text: `${index + 1}通目` },
    }));

    const accepted = await app(testDb.db).request('/api/broadcasts/draft-five', json('PUT', {
      messageBubbles: bubbles,
    }));
    expect(accepted.status).toBe(200);

    const rejected = await app(testDb.db).request('/api/broadcasts/draft-five', json('PUT', {
      messageBubbles: [...bubbles, bubbles[0]],
    }));
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: 'messageBubbles must contain 1 to 5 items' });
  });

  it('通常: 対象3人・除外理由・送信枠・同時刻配信・21条件軸を実データで返す', async () => {
    insertFriend(testDb.raw, 'friend-ready', {
      line_account_id: 'account-1', display_name: '山田 太郎', updated_at: '2026-09-07T10:00:00.000Z',
    });
    insertFriend(testDb.raw, 'friend-hidden', {
      line_account_id: 'account-1', display_name: '非表示', is_hidden: 1, updated_at: '2026-09-07T09:00:00.000Z',
    });
    insertFriend(testDb.raw, 'friend-blocked', {
      line_account_id: 'account-1', display_name: 'ブロック', is_following: 0, updated_at: '2026-09-07T08:00:00.000Z',
    });
    seedBroadcast(testDb, 'scheduled-near', {
      status: 'scheduled', sent_at: null, scheduled_at: '2026-09-08T10:30:00.000Z', total_count: 0, success_count: 0,
    });

    const response = await app(testDb.db).request('/api/broadcasts/preflight', json('POST', {
      targetType: 'all', lineAccountId: 'account-1', messageContent: 'お知らせ',
      scheduledAt: '2026-09-08T10:00:00.000Z', messageCount: 1,
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        audience: { matched: number; sendable: number; representatives: unknown[] };
        exclusions: Record<string, number | null>;
        quota: Record<string, unknown>;
        concurrentBroadcasts: unknown[];
        conditionAxes: { standard: unknown[]; broadcastOnly: unknown[] };
      };
    };
    expect(body.data.audience).toMatchObject({ matched: 3, sendable: 1 });
    expect(body.data.audience.representatives).toHaveLength(1);
    expect(body.data.exclusions).toMatchObject({ blocked: 1, hidden: 1, total: 2, paused: null });
    expect(body.data.quota).toEqual({
      monthlyUsed: 1213, monthlyLimit: 5000, remaining: 3787, planned: 1, state: 'available', reason: null,
    });
    expect(body.data.concurrentBroadcasts).toHaveLength(1);
    expect(body.data.conditionAxes.standard).toHaveLength(15);
    expect(body.data.conditionAxes.broadcastOnly).toHaveLength(6);
  });

  it('一覧とKPIは担当テナントだけを集計し、statsを配信IDとして扱わない', async () => {
    seedBroadcast(testDb, 'own-broadcast', { total_count: 12, success_count: 10 });
    seedBroadcast(testDb, 'other-broadcast', {
      line_account_id: 'account-2', total_count: 100, success_count: 99,
    });

    const listResponse = await app(testDb.db).request('/api/broadcasts');
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: [{ id: 'own-broadcast' }],
      kpis: { delivered: 10 },
      pagination: { total: 1 },
    });

    const statsResponse = await app(testDb.db).request('/api/broadcasts/stats');
    expect(statsResponse.status).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      success: true,
      data: { delivered: 10, failed: 2 },
    });
  });

  it('空・権限不足・DB失敗を別状態で返す', async () => {
    const empty = await app(testDb.db).request('/api/broadcasts/saved-views?lineAccountId=account-1');
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ success: true, data: [] });

    const forbidden = await app(testDb.db).request('/api/broadcasts/saved-views?lineAccountId=account-2');
    expect(forbidden.status).toBe(403);

    const failingDb = {
      prepare: () => ({ bind: () => ({ all: async () => { throw new Error('db unavailable'); } }) }),
    } as unknown as D1Database;
    const failed = await app(failingDb).request('/api/broadcasts/saved-views?lineAccountId=account-1');
    expect(failed.status).toBe(500);
  });

  it('Slack通知の3状態を版付きで保存し、古い版は409にする', async () => {
    const initial = await app(testDb.db).request(
      '/api/broadcasts/notification-settings?lineAccountId=account-1',
    );
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({
      data: {
        version: 0, started: true, completed: true, failed: true,
        displayText: '配信開始・完了・エラーはSlackの同じスレッドへ通知します。',
      },
    });

    const saved = await app(testDb.db).request(
      '/api/broadcasts/notification-settings?lineAccountId=account-1',
      json('PUT', { expectedVersion: 0, started: true, completed: false, failed: true }),
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      data: { version: 1, displayText: '配信開始・エラーはSlackの同じスレッドへ通知します。' },
    });

    const conflict = await app(testDb.db).request(
      '/api/broadcasts/notification-settings?lineAccountId=account-1',
      json('PUT', { expectedVersion: 0, started: true, completed: true, failed: true }),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: 'version_conflict' });
  });

  it('途中下書きとメッセージ設定を保存し、版競合を409にする', async () => {
    testDb.raw.prepare(`
      INSERT INTO common_actions
        (id, line_account_id, name, status, current_published_version_id, created_at, updated_at)
      VALUES ('action-1', 'account-1', '配信済みタグ', 'published', 'action-version-1',
              '2026-09-07T10:00:00.000Z', '2026-09-07T10:00:00.000Z')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO common_action_versions
        (id, common_action_id, version_number, status, action_config, created_at, published_at)
      VALUES ('action-version-1', 'action-1', 1, 'published', '[]',
              '2026-09-07T10:00:00.000Z', '2026-09-07T10:00:00.000Z')
    `).run();
    const created = await app(testDb.db).request('/api/broadcasts', json('POST', {
      saveAsDraft: true,
      draftStep: 'basic',
      lineAccountId: 'account-1',
      internalMemo: '社内だけのメモ',
      scheduledAt: '2026-09-08T10:00:00.000Z',
      messageOptions: {
        buttons: [{ label: '資料を見る', type: 'pdf', value: 'https://example.com/guide.pdf' }],
      },
      afterActionVersionId: 'action-version-1',
    }));
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { data: { id: string; version: number; draftPayload: unknown } };
    expect(createdBody.data).toMatchObject({
      version: 1,
      status: 'draft',
      draftPayload: { saveAsDraft: true, draftStep: 'basic' },
    });

    const updated = await app(testDb.db).request(`/api/broadcasts/${createdBody.data.id}`, json('PUT', {
      saveAsDraft: true,
      scheduledAt: '2026-09-09T10:00:00.000Z',
      draftStep: 'audience',
      internalMemo: '更新後',
      expectedVersion: 1,
    }));
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: { version: 2, status: 'draft', draftStep: 'audience', internalMemo: '更新後' },
    });

    const conflict = await app(testDb.db).request(`/api/broadcasts/${createdBody.data.id}`, json('PUT', {
      saveAsDraft: true, internalMemo: '古い画面から更新', expectedVersion: 1,
    }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('保存した検索はアカウント内だけに保存し、同名を409にする', async () => {
    const request = json('POST', {
      name: '予約中のみ', filters: { statuses: ['scheduled'] }, sortKey: 'newest', pageSize: 20,
    });
    const created = await app(testDb.db).request('/api/broadcasts/saved-views?lineAccountId=account-1', request);
    expect(created.status).toBe(201);
    const duplicate = await app(testDb.db).request('/api/broadcasts/saved-views?lineAccountId=account-1', request);
    expect(duplicate.status).toBe(409);
    const denied = await app(testDb.db, staff).request(
      '/api/broadcasts/saved-views?lineAccountId=account-1', request,
    );
    expect(denied.status).toBe(403);
  });

  it('配信に紐づくURLだけのクリック内訳とLINE開封母数を返す', async () => {
    insertFriend(testDb.raw, 'friend-1', { line_account_id: 'account-1', display_name: '山田 太郎' });
    seedBroadcast(testDb, 'broadcast-1');
    testDb.raw.prepare(`
      INSERT INTO tracked_links
        (id, name, original_url, line_account_id, short_code, dedup_key, is_active, click_count, created_at, updated_at)
      VALUES ('link-1', '商品を見る', 'https://example.com/campaign', 'account-1', 'Abc1234',
              'account-1|broadcast:broadcast-1|https://example.com/campaign', 1, 1,
              '2026-09-07T10:00:00.000Z', '2026-09-07T10:00:00.000Z')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO broadcast_tracked_links (broadcast_id, tracked_link_id, label, created_at)
      VALUES ('broadcast-1', 'link-1', '商品を見る', '2026-09-07T10:00:00.000Z')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
      VALUES ('click-1', 'link-1', 'friend-1', '2026-09-07T10:05:00.000Z')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO broadcast_insights
        (id, broadcast_id, delivered, unique_impression, unique_click, open_rate, click_rate, status, fetched_at)
      VALUES ('insight-1', 'broadcast-1', 10, 7, 1, 0.7, 0.1, 'ready', '2026-09-07T11:00:00.000Z')
    `).run();

    const response = await app(testDb.db).request('/api/broadcasts/broadcast-1/insight');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        opens: { count: 7, denominator: 10, rate: 0.7, state: 'available' },
        links: [{ label: '商品を見る', clickCount: 1, uniqueClickCount: 1, clickRate: 0.1 }],
      },
    });
  });
});
