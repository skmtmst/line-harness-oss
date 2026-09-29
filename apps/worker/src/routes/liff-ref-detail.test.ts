import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { liffRoutes } from './liff.js';

const access = vi.hoisted(() => ({
  getScope: vi.fn(),
}));
vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: access.getScope,
  canAccessAllLineAccounts: vi.fn().mockReturnValue(true),
}));

type FriendRow = {
  id: string;
  display_name: string;
  ref_code: string | null;
  is_following: number;
  tracked_at: string | null;
};

const friends: FriendRow[] = [
  { id: 'friend-1', display_name: '続いている人', ref_code: 'summer-ig', is_following: 1, tracked_at: '2026-08-25T09:12:00.000Z' },
  { id: 'friend-2', display_name: '離れた人', ref_code: 'summer-ig', is_following: 0, tracked_at: '2026-08-24T21:40:00.000Z' },
];

function database(): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { binds = values; return statement; },
        async all() {
          if (sql.includes('FROM friends f')) {
            const [refCode] = binds as [string];
            return {
              results: friends
                .filter((f) => f.ref_code === refCode)
                .map((f) => ({
                  id: f.id,
                  display_name: f.display_name,
                  ref_code: f.ref_code,
                  is_following: f.is_following,
                  tracked_at: f.tracked_at,
                })),
            };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM entry_routes')) {
            return { ref_code: 'summer-ig', name: '夏のInstagram投稿' };
          }
          return null;
        },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function app() {
  const instance = new Hono();
  instance.use('*', async (c, next) => {
    c.set('staff' as never, { id: 'owner-1', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', liffRoutes);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  access.getScope.mockResolvedValue({ allowedAccountIds: [], canSeeUnassigned: true });
});

describe('GET /api/analytics/ref/:refCode (#514-8)', () => {
  test('いまの状態を口から返す(友だち中・ブロック済み)', async () => {
    const response = await app().request('/api/analytics/ref/summer-ig', { headers: {} }, { DB: database() });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      success: boolean;
      data: { refCode: string; name: string; friends: Array<{ id: string; displayName: string; trackedAt: string | null; currentStatus: string }> };
    };
    expect(body.success).toBe(true);
    expect(body.data.refCode).toBe('summer-ig');
    expect(body.data.friends).toHaveLength(2);
    expect(body.data.friends[0].currentStatus).toBe('友だち中');
    expect(body.data.friends[1].currentStatus).toBe('ブロック済み');
  });

  test('口が返さない欄(はじめて見たページ・成果・マイル)を含めない', async () => {
    const response = await app().request('/api/analytics/ref/summer-ig', { headers: {} }, { DB: database() });
    const body = await response.json() as {
      success: boolean;
      data: { friends: Array<Record<string, unknown>> };
    };
    for (const friend of body.data.friends) {
      expect(friend).not.toHaveProperty('firstPage');
      expect(friend).not.toHaveProperty('conversion');
      expect(friend).not.toHaveProperty('miles');
    }
  });
});
