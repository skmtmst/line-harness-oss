import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friends } from './friends.js';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';

function createApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friends);
  return {
    app,
    env: { DB: db } as Env['Bindings'],
  };
}

function seedScopeFixture(testDb: SqliteD1): void {
  testDb.raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(DEFAULT_TENANT_ID, '既定統括');
  testDb.raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(OTHER_TENANT_ID, '別統括');

  const insertAccount = testDb.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES (?, ?, ?, 'token', 'secret', 1, ?)
  `);
  insertAccount.run('account-a', 'channel-a', '店舗A', DEFAULT_TENANT_ID);
  insertAccount.run('account-b', 'channel-b', '店舗B', DEFAULT_TENANT_ID);
  insertAccount.run('account-foreign', 'channel-foreign', '別統括店舗', OTHER_TENANT_ID);

  const insertStaff = testDb.raw.prepare(`
    INSERT INTO staff_members
      (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
    VALUES (?, ?, 'staff', 'full', ?, '["/friends"]', ?, ?)
  `);
  insertStaff.run('staff-all', '全店舗担当', 'key-all', 'all', DEFAULT_TENANT_ID);
  insertStaff.run('staff-partial', '店舗A担当', 'key-partial', 'accounts', DEFAULT_TENANT_ID);
  insertStaff.run('staff-empty', '担当未設定', 'key-empty', 'accounts', DEFAULT_TENANT_ID);
  testDb.raw.prepare(`
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES ('staff-partial', 'account-a', '2026-09-09T00:00:00.000Z')
  `).run();

  const createdAt = new Date().toISOString();
  const seedFriend = (id: string, lineAccountId: string | null) => insertFriend(testDb.raw, id, {
    line_account_id: lineAccountId,
    ref_code: `ref-${id}`,
    created_at: createdAt,
    updated_at: createdAt,
  });
  seedFriend('friend-a-1', 'account-a');
  seedFriend('friend-a-2', 'account-a');
  seedFriend('friend-b-1', 'account-b');
  seedFriend('friend-unassigned', null);
  seedFriend('friend-foreign', 'account-foreign');
}

type FriendListResponse = {
  data: { items: Array<{ id: string }>; total: number };
};
type FriendCountResponse = { data: { count: number } };
type FriendRefStatsResponse = { data: { totalWithRef: number } };
type FriendAddBreakdownResponse = { data: { firstTime: number; returning: number } };
type FriendStatsResponse = { data: { total: number } };

describe('N-032 friend stats account scope integration (#664)', () => {
  let testDb: SqliteD1;
  let target: ReturnType<typeof createApp>;

  beforeEach(() => {
    testDb = createTestD1();
    seedScopeFixture(testDb);
    target = createApp(testDb.db);
  });

  afterEach(() => {
    testDb.raw.close();
  });

  async function get(path: string, apiKey?: string): Promise<Response> {
    return target.app.request(path, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    }, target.env);
  }

  async function visibleCounts(apiKey: string, lineAccountId?: string) {
    const accountQuery = lineAccountId ? `&lineAccountId=${lineAccountId}` : '';
    const lineAccountQuery = lineAccountId ? `?lineAccountId=${lineAccountId}` : '';
    const statsQuery = lineAccountId ? `?accountId=${lineAccountId}` : '';
    const [listResponse, countResponse, refResponse, breakdownResponse, statsResponse] = await Promise.all([
      get(`/api/friends?includeTags=false&limit=50${accountQuery}`, apiKey),
      get(`/api/friends/count${lineAccountQuery}`, apiKey),
      get(`/api/friends/ref-stats${lineAccountQuery}`, apiKey),
      get(`/api/friends/add-breakdown?days=30${accountQuery}`, apiKey),
      get(`/api/friends/stats${statsQuery}`, apiKey),
    ]);
    for (const response of [listResponse, countResponse, refResponse, breakdownResponse, statsResponse]) {
      expect(response.status).toBe(200);
    }
    const [list, count, ref, breakdown, stats] = await Promise.all([
      listResponse.json() as Promise<FriendListResponse>,
      countResponse.json() as Promise<FriendCountResponse>,
      refResponse.json() as Promise<FriendRefStatsResponse>,
      breakdownResponse.json() as Promise<FriendAddBreakdownResponse>,
      statsResponse.json() as Promise<FriendStatsResponse>,
    ]);
    return {
      ids: list.data.items.map((friend) => friend.id).sort(),
      list: list.data.total,
      count: count.data.count,
      refStats: ref.data.totalWithRef,
      addBreakdown: breakdown.data.firstTime + breakdown.data.returning,
      stats: stats.data.total,
    };
  }

  it.each([
    {
      label: '全権限は同じ統括の2店舗と未割当だけを見る',
      apiKey: 'key-all',
      expectedIds: ['friend-a-1', 'friend-a-2', 'friend-b-1', 'friend-unassigned'],
    },
    {
      label: '部分権限は割り当てられた店舗Aだけを見る',
      apiKey: 'key-partial',
      expectedIds: ['friend-a-1', 'friend-a-2'],
    },
    {
      label: '空権限は誰も見ない',
      apiKey: 'key-empty',
      expectedIds: [],
    },
  ])('$label: 一覧と4集計口が同じ人数になる', async ({ apiKey, expectedIds }) => {
    const result = await visibleCounts(apiKey);
    expect(result.ids).toEqual(expectedIds);
    expect(result).toMatchObject({
      list: expectedIds.length,
      count: expectedIds.length,
      refStats: expectedIds.length,
      addBreakdown: expectedIds.length,
      stats: expectedIds.length,
    });
  });

  it('部分権限で担当店舗を明示しても一覧と4集計口が同じ2人になる', async () => {
    const result = await visibleCounts('key-partial', 'account-a');
    expect(result).toEqual({
      ids: ['friend-a-1', 'friend-a-2'],
      list: 2,
      count: 2,
      refStats: 2,
      addBreakdown: 2,
      stats: 2,
    });
  });

  it('部分権限から未担当店舗・別統括を明示しても4集計口は404にする', async () => {
    const hiddenAccountIds = ['account-b', 'account-foreign'] as const;
    for (const accountId of hiddenAccountIds) {
      const paths = [
        `/api/friends/add-breakdown?lineAccountId=${accountId}`,
        `/api/friends/count?lineAccountId=${accountId}`,
        `/api/friends/ref-stats?lineAccountId=${accountId}`,
        `/api/friends/stats?accountId=${accountId}`,
      ];
      for (const path of paths) {
        const response = await get(path, 'key-partial');
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ success: false, error: 'Not found' });
      }
    }
  });

  it('認証middlewareを通り、資格情報がなければ一覧も4集計口も401にする', async () => {
    const paths = [
      '/api/friends?includeTags=false',
      '/api/friends/add-breakdown',
      '/api/friends/count',
      '/api/friends/ref-stats',
      '/api/friends/stats',
    ];
    for (const path of paths) {
      expect((await get(path)).status).toBe(401);
    }
  });
});
