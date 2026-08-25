import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getDashboardOverview: vi.fn(),
  getLineAccounts: vi.fn(),
  getLineAccountById: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  ...dbMocks,
  getListStats: vi.fn(),
}));

import { dashboard } from './dashboard.js';

const account = (id: string) => ({
  id, channel_id: id, name: id, channel_access_token: `${id}-token`,
  channel_secret: 'secret', is_active: 1, parent_line_account_id: null,
});

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当者', role: 'staff', readOnly: false,
      assignedLineAccountId: 'account-1', canAccessDescendantAccounts: false,
    });
    return next();
  });
  instance.route('/', dashboard);
  return instance;
}

function env(): Env['Bindings'] {
  return { DB: {} as D1Database, LINE_CHANNEL_ACCESS_TOKEN: 'env-token' } as Env['Bindings'];
}

describe('dashboard organization account policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    dbMocks.getLineAccounts.mockResolvedValue([account('account-1'), account('account-2')]);
    dbMocks.getLineAccountById.mockImplementation(async (_db: unknown, id: string) => account(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('staff can select another account in the same organization', async () => {
    dbMocks.getDashboardOverview.mockResolvedValue({ delivery: {}, partialFailures: [] });
    const response = await app().request('/api/dashboard/overview?accountId=account-2', {}, env());
    expect(response.status).toBe(200);
    expect(dbMocks.getDashboardOverview).toHaveBeenCalledWith(expect.anything(), 'today', 'account-2');
  });

  test('staff can request the organization-wide overview without an explicit account', async () => {
    dbMocks.getDashboardOverview.mockResolvedValue({ delivery: {}, partialFailures: [] });
    const response = await app().request('/api/dashboard/overview', {}, env());
    expect(response.status).toBe(200);
    expect(dbMocks.getDashboardOverview).toHaveBeenCalledWith(expect.anything(), 'today', null);
  });
});
