import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getDashboardOverview: vi.fn(),
  getLineAccounts: vi.fn(),
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
  };
}

describe('dashboard organization account policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    dbMocks.getLineAccounts.mockResolvedValue([account('account-1'), account('account-2')]);
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
