import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getDashboardOverview: vi.fn(),
  getLineAccounts: vi.fn(),
  getLineAccountScopeEntries: vi.fn(),
  getLineAccountsByIds: vi.fn(),
  getLineAccountById: vi.fn(),
  getDashboardPreference: vi.fn(),
  getDashboardDefaultPreference: vi.fn(),
  saveDashboardPreference: vi.fn(),
  deleteDashboardPreference: vi.fn(),
  saveDashboardDefaultPreference: vi.fn(),
  getListStats: vi.fn(),
  getStaffById: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  ...dbMocks,
}));

import { dashboard } from './dashboard.js';

const account = (id: string) => ({
  id, channel_id: id, name: id, channel_access_token: `${id}-token`,
  channel_secret: 'secret', is_active: 1, parent_line_account_id: null,
  official_profile_url: null, updated_at: '2026-08-26T10:00:00+09:00',
});

function app(tenantId?: string, role: 'owner' | 'admin' | 'staff' = 'staff') {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当者', role, readOnly: false,
      assignedLineAccountId: 'account-1', canAccessDescendantAccounts: false,
      tenantId,
    });
    return next();
  });
  instance.route('/', dashboard);
  return instance;
}

function env(): Env['Bindings'] {
  return { DB: {} as D1Database, LINE_CHANNEL_ACCESS_TOKEN: 'env-token' } as Env['Bindings'];
}

function overview(delivery: Record<string, unknown> = {}) {
  return {
    delivery,
    partialFailures: [],
    sections: { quota: { status: 'unavailable', asOf: '2026-08-26T10:00:00+09:00', period: 'this-month' } },
    metrics: {
      activeFriends: {
        value: 0, state: 'empty', reason: null,
        asOf: '2026-08-26T10:00:00+09:00', period: 'latest',
      },
      monthlyQuota: {
        value: null, state: 'unavailable', reason: 'not_loaded', asOf: null, period: 'this-month',
      },
      friendTrend: {
        value: [], state: 'empty', reason: null,
        asOf: '2026-08-26T10:00:00+09:00', period: 'last7-fixed',
      },
      officialProfileUrl: {
        value: null, state: 'unavailable', reason: 'not_loaded', asOf: null, period: 'latest',
      },
    },
  };
}

describe('dashboard organization account policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    dbMocks.getLineAccounts.mockResolvedValue([account('account-1'), account('account-2')]);
    dbMocks.getLineAccountScopeEntries.mockImplementation(async () =>
      dbMocks.getLineAccounts());
    dbMocks.getLineAccountsByIds.mockImplementation(async (_db, ids: string[]) => {
      const rows = await dbMocks.getLineAccounts();
      return rows.filter((row: { id: string }) => ids.includes(row.id));
    });
    dbMocks.getStaffById.mockResolvedValue({ account_scope: 'all' });
    dbMocks.getStaffAccountScopeIds.mockResolvedValue([]);
    dbMocks.getLineAccountById.mockImplementation(async (_db: unknown, id: string) => account(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('staff can select another account in the same organization', async () => {
    dbMocks.getDashboardOverview.mockResolvedValue(overview());
    const response = await app().request('/api/dashboard/overview?accountId=account-2', {}, env());
    expect(response.status).toBe(200);
    expect(dbMocks.getDashboardOverview).toHaveBeenCalledWith(expect.anything(), 'today', {
      allowedAccountIds: ['account-2'], includeUnassigned: false,
    });
  });

  test('account-scoped staff cannot select an unassigned account', async () => {
    dbMocks.getStaffById.mockResolvedValue({ account_scope: 'accounts' });
    dbMocks.getStaffAccountScopeIds.mockResolvedValue(['account-1']);

    const response = await app().request('/api/dashboard/overview?accountId=account-2', {}, env());

    expect(response.status).toBe(404);
    expect(dbMocks.getLineAccountById).not.toHaveBeenCalled();
    expect(dbMocks.getDashboardOverview).not.toHaveBeenCalled();
  });

  test('an explicit account is required instead of silently aggregating visible accounts', async () => {
    const response = await app().request('/api/dashboard/overview', {}, env());
    expect(response.status).toBe(400);
    expect(dbMocks.getDashboardOverview).not.toHaveBeenCalled();
  });

  test('list stats can be limited to the explicitly selected visible account', async () => {
    dbMocks.getListStats.mockResolvedValue({});
    const response = await app().request('/api/list-stats?accountId=account-1', {}, env());
    expect(response.status).toBe(200);
    expect(dbMocks.getListStats).toHaveBeenCalledWith(expect.anything(), {
      allowedAccountIds: ['account-1'], includeUnassigned: false,
    });
  });

  test('list stats reject an account outside the visible account scope', async () => {
    const response = await app().request('/api/list-stats?accountId=account-missing', {}, env());
    expect(response.status).toBe(404);
    expect(dbMocks.getListStats).not.toHaveBeenCalled();
  });

  test('non-default tenant uses only the explicitly selected account token for quota', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...account('account-1'), tenant_id: 'tenant-b' },
      { ...account('account-2'), tenant_id: 'tenant-a' },
    ]);
    dbMocks.getDashboardOverview.mockResolvedValue(overview({ sent: 12, broadcasts: 3 }));
    const response = await app('tenant-b').request('/api/dashboard/overview?accountId=account-1', {}, env());

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { Authorization: 'Bearer account-1-token' },
    }));
    expect(dbMocks.getDashboardOverview).toHaveBeenCalledWith(expect.anything(), 'today', {
      allowedAccountIds: ['account-1'], includeUnassigned: false,
    });
    const body = await response.json() as { data: { delivery: Record<string, unknown> } };
    expect(body.data.delivery).toMatchObject({
      sent: 12, broadcasts: 3, quotaLimit: null, quotaUsed: null,
    });
  });

  test('returns real quota values and the configured official profile URL', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...account('account-1'),
      official_profile_url: 'https://lin.ee/nen-official',
    });
    dbMocks.getDashboardOverview.mockResolvedValue(overview());
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/quota')) return Response.json({ type: 'limited', value: 200 });
      return Response.json({ totalUsage: 3 });
    });

    const response = await app().request('/api/dashboard/overview?accountId=account-1', {}, env());
    const body = await response.json() as { data: ReturnType<typeof overview> };

    expect(response.status).toBe(200);
    expect(body.data.metrics.monthlyQuota).toMatchObject({
      value: { used: 3, limit: 200, remaining: 197 },
      state: 'available', reason: null, period: 'this-month',
    });
    expect(body.data.metrics.monthlyQuota.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.data.metrics.officialProfileUrl).toEqual({
      value: 'https://lin.ee/nen-official',
      state: 'available',
      reason: null,
      asOf: '2026-08-26T10:00:00+09:00',
      period: 'latest',
    });
  });

  test('unconfigured LINE connection returns null instead of a false zero', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...account('account-1'), channel_access_token: '', official_profile_url: null,
    });
    dbMocks.getDashboardOverview.mockResolvedValue(overview());

    const response = await app().request('/api/dashboard/overview?accountId=account-1', {}, env());
    const body = await response.json() as { data: ReturnType<typeof overview> };

    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(body.data.metrics.monthlyQuota).toMatchObject({
      value: null, state: 'unavailable', reason: 'not_connected', asOf: null,
    });
    expect(body.data.metrics.officialProfileUrl).toMatchObject({
      value: null, state: 'unavailable', reason: 'not_connected', asOf: null,
    });
  });

  test('LINE quota failure returns null and records a partial failure', async () => {
    dbMocks.getDashboardOverview.mockResolvedValue(overview());
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

    const response = await app().request('/api/dashboard/overview?accountId=account-1', {}, env());
    const body = await response.json() as { data: ReturnType<typeof overview> };

    expect(response.status).toBe(200);
    expect(body.data.metrics.monthlyQuota).toMatchObject({
      value: null, state: 'unavailable', reason: 'fetch_failed', asOf: null,
    });
    expect(body.data.partialFailures).toContain('quota');
  });

  test('loads the signed-in staff preference for the selected account', async () => {
    dbMocks.getDashboardPreference.mockResolvedValue({
      version: 2,
      cards: JSON.stringify({
        today: [{ id: 'today-inbox', visible: true }],
        main: [{ id: 'friend-trend', visible: true }],
        right: [{ id: 'send-quota', visible: true }],
      }),
      updated_at: '2026-08-26T10:00:00+09:00',
    });
    const response = await app().request('/api/dashboard/preferences?account_id=account-1', {}, env());
    expect(response.status).toBe(200);
    expect(dbMocks.getDashboardPreference).toHaveBeenCalledWith(expect.anything(), 'staff-1', 'account-1');
    expect(await response.json()).toMatchObject({ data: { source: 'personal', version: 2 } });
  });

  test('rejects unknown cards instead of persisting arbitrary JSON', async () => {
    const response = await app().request('/api/dashboard/preferences?account_id=account-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 0,
        cards: { today: [{ id: 'unknown', visible: true }], main: [], right: [] },
      }),
    }, env());
    expect(response.status).toBe(400);
    expect(dbMocks.saveDashboardPreference).not.toHaveBeenCalled();
  });

  test('organization quota fetch runs at most five accounts at a time', async () => {
    const accounts = Array.from({ length: 12 }, (_, index) => ({
      ...account(`account-${index + 1}`), tenant_id: 'tenant-b',
    }));
    dbMocks.getLineAccounts.mockResolvedValue(accounts);
    dbMocks.getDashboardOverview.mockResolvedValue(overview());
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const url = String(input);
      return url.endsWith('/quota')
        ? Response.json({ type: 'limited', value: 100 })
        : Response.json({ totalUsage: 1 });
    });

    const response = await app('tenant-b', 'owner').request('/api/dashboard/organization-overview', {}, env());
    const body = await response.json() as { data: ReturnType<typeof overview> };

    expect(response.status).toBe(200);
    /* 12件×2口=24回は全部取りに行くが、同時は5件ぶん(10口)までに抑える。 */
    expect(fetch).toHaveBeenCalledTimes(24);
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(body.data.metrics.monthlyQuota).toMatchObject({
      value: { used: 12, limit: 1200, remaining: 1188 },
      state: 'available', reason: null,
    });
  });

  test('organization totals are available only to owners and stay inside their tenant', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...account('account-1'), tenant_id: 'tenant-b' },
      { ...account('account-2'), tenant_id: 'tenant-a' },
    ]);
    dbMocks.getDashboardOverview.mockResolvedValue(overview());
    expect((await app('tenant-b').request('/api/dashboard/organization-overview', {}, env())).status).toBe(403);

    const response = await app('tenant-b', 'owner').request('/api/dashboard/organization-overview', {}, env());
    expect(response.status).toBe(200);
    expect(dbMocks.getDashboardOverview).toHaveBeenCalledWith(expect.anything(), 'today', {
      allowedAccountIds: ['account-1'], includeUnassigned: false,
    });
  });
});
