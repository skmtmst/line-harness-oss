import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  prepare: vi.fn(),
  getNenCampaign: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('@line-crm/db', () => ({
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-08-25 12:00:00'),
}));
vi.mock('../services/nen-engagement.js', () => ({
  buildDefaultColumnIntro: vi.fn((title: string) => title),
  buildNenDeliveryMessages: vi.fn(),
  getNenCampaign: mocks.getNenCampaign,
  queueColumnDelivery: vi.fn(),
  saveNenCampaignAccountSetting: vi.fn(),
  getNenBirthdayCouponSetting: vi.fn(),
  saveNenBirthdayCouponSetting: vi.fn(),
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: vi.fn() }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));

const { nenCampaigns } = await import('./nen-campaigns.js');

function app() {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    c.env = { DB: { prepare: mocks.prepare } as unknown as D1Database };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.getNenCampaign.mockResolvedValue(null);
  mocks.prepare.mockImplementation((sql: string) => {
    const statement = {
      bind: (..._args: unknown[]) => statement,
      first: vi.fn(async () => {
        if (sql.includes('FROM nen_delivery_jobs')) return { total: 10, pending: 4, sent: 5, failed: 1 };
        return { count: 0 };
      }),
      all: vi.fn(async () => ({ results: [] })),
    };
    return statement;
  });
});

describe('overview の待ち件数(点検 #512 の中2)', () => {
  test('jobs.pending は pending-now 口と同じ未来ぶんの決めごと', async () => {
    const res = await app().request('/api/nen-campaigns/overview?lineAccountId=account-a');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { jobs: { pending: number } } };
    expect(body.success).toBe(true);
    expect(body.data.jobs.pending).toBe(4);
    const jobsSql = mocks.prepare.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes('FROM nen_delivery_jobs'));
    // 一覧の窓付き集計ではなく、未来ぶんだけを数える。
    expect(jobsSql).toContain("status = 'pending' AND datetime(scheduled_at) > datetime('now')");
  });

  test('pendingByCampaign は配信ごとの未来ぶんを返す(#935 N-299)', async () => {
    mocks.prepare.mockImplementation((sql: string) => {
      const statement = {
        bind: (..._args: unknown[]) => statement,
        first: vi.fn(async () => {
          if (sql.includes('FROM nen_delivery_jobs')) return { total: 10, pending: 4, sent: 5, failed: 1 };
          return { count: 0 };
        }),
        all: vi.fn(async () => {
          if (sql.includes('GROUP BY campaign_key')) {
            return { results: [
              { campaign_key: 'arrival_check', count: 3 },
              { campaign_key: 'column', count: 1 },
            ] };
          }
          return { results: [] };
        }),
      };
      return statement;
    });
    const res = await app().request('/api/nen-campaigns/overview?lineAccountId=account-a');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { jobs: { pending: number; pendingByCampaign: Record<string, number> } };
    };
    expect(body.data.jobs.pendingByCampaign).toEqual({ arrival_check: 3, column: 1 });
    const sql = mocks.prepare.mock.calls
      .map((call) => String(call[0]))
      .find((entry) => entry.includes('GROUP BY campaign_key'));
    // 全体の pending と同じ決めごと（未来ぶんだけ）で配信ごとに分ける。
    expect(sql).toContain("status = 'pending' AND datetime(scheduled_at) > datetime('now')");
  });
});
