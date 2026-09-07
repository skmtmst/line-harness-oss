import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  getScope: vi.fn(),
  computeStats: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: mocks.getScope,
}));

vi.mock('../services/duplicates-stats.js', () => ({
  computeDuplicatesStats: mocks.computeStats,
}));

const { duplicates } = await import('./duplicates.js');

function setupApp(role: string | null) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    if (role) {
      c.set('staff', { id: 'staff-1', role, tenantId: 'tenant-a' });
    }
    c.env = { DB: {} };
    await next();
  });
  app.route('/', duplicates);
  return app;
}

describe('GET /api/duplicates/stats (#496-14)', () => {
  beforeEach(() => {
    mocks.getScope.mockReset();
    mocks.computeStats.mockReset();
    mocks.computeStats.mockResolvedValue({
      total_following: 0,
      unique_people: 0,
      friend_dups: 0,
      duplicate_groups: 0,
      wasted_per_broadcast_yen: 0,
      msg_unit_yen: 3,
      per_account: [],
      pairwise_overlap: [],
      computed_at: new Date().toISOString(),
    });
  });

  test('未ログインは403', async () => {
    const res = await setupApp(null).request('/api/duplicates/stats');
    expect(res.status).toBe(403);
    expect(mocks.computeStats).not.toHaveBeenCalled();
  });

  test('可視アカウントだけを集計に渡す', async () => {
    mocks.getScope.mockResolvedValue({
      accounts: [], allowedAccountIds: ['account-a'], canSeeUnassigned: false, ids: ['account-a'],
    });

    const res = await setupApp('staff').request('/api/duplicates/stats');

    expect(res.status).toBe(200);
    expect(mocks.computeStats).toHaveBeenCalledWith({}, { forceRefresh: false, accountIds: ['account-a'] });
  });

  test('見られる先が無い人は空の集計になる', async () => {
    mocks.getScope.mockResolvedValue({
      accounts: [], allowedAccountIds: [], canSeeUnassigned: false, ids: [],
    });

    const res = await setupApp('staff').request('/api/duplicates/stats');

    expect(res.status).toBe(200);
    expect(mocks.computeStats).toHaveBeenCalledWith({}, { forceRefresh: false, accountIds: [] });
    const body = await res.json() as { success: boolean; data: { totalFollowing: number } };
    expect(body.data.totalFollowing).toBe(0);
  });
});
