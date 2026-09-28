import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getDashboardUpcoming: vi.fn(),
  getDeliveryFailureOrigins: vi.fn(),
  getLineAccounts: vi.fn(),
  getLineAccountScopeEntries: vi.fn(),
  getStaffById: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { dashboard } from './dashboard.js';

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

const visibleAccount = (id: string) => ({ id, channel_id: id, name: id });

function mockVisibleScope(): void {
  dbMocks.getLineAccounts.mockResolvedValue([visibleAccount('account-1')]);
  dbMocks.getLineAccountScopeEntries.mockImplementation(async () => dbMocks.getLineAccounts());
  dbMocks.getStaffById.mockResolvedValue({ account_scope: 'all' });
  dbMocks.getStaffAccountScopeIds.mockResolvedValue([]);
}

describe('dashboard upcoming (M 今後の予定)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVisibleScope();
    dbMocks.getDashboardUpcoming.mockResolvedValue({ items: [], asOf: 'now', rangeDays: 7 });
  });

  test('アカウント未指定は400で束ね処理を呼ばない', async () => {
    const response = await app().request('/api/dashboard/upcoming', {}, env());
    expect(response.status).toBe(400);
    expect(dbMocks.getDashboardUpcoming).not.toHaveBeenCalled();
  });

  test('範囲外のアカウントは404で束ね処理を呼ばない', async () => {
    dbMocks.getStaffById.mockResolvedValue({ account_scope: 'accounts' });
    dbMocks.getStaffAccountScopeIds.mockResolvedValue(['account-1']);
    const response = await app().request('/api/dashboard/upcoming?account_id=account-2', {}, env());
    expect(response.status).toBe(404);
    expect(dbMocks.getDashboardUpcoming).not.toHaveBeenCalled();
  });

  test('7日分を既定で束ねる', async () => {
    const response = await app().request('/api/dashboard/upcoming?account_id=account-1', {}, env());
    expect(response.status).toBe(200);
    expect(dbMocks.getDashboardUpcoming).toHaveBeenCalledWith(expect.anything(), {
      lineAccountId: 'account-1', now: expect.any(String), days: 7,
    });
    const body = await response.json() as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
  });

  test('日数は1〜31に収める', async () => {
    await app().request('/api/dashboard/upcoming?account_id=account-1&days=99', {}, env());
    expect(dbMocks.getDashboardUpcoming).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ days: 31 }));
  });
});

describe('dashboard delivery-failure-origins (L 数字の出どころ)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVisibleScope();
    dbMocks.getDeliveryFailureOrigins.mockResolvedValue({ total: 0, asOf: null, origins: [] });
  });

  test('アカウント未指定は400で集計を呼ばない', async () => {
    const response = await app().request('/api/dashboard/delivery-failure-origins', {}, env());
    expect(response.status).toBe(400);
    expect(dbMocks.getDeliveryFailureOrigins).not.toHaveBeenCalled();
  });

  test('範囲外のアカウントは404で集計を呼ばない', async () => {
    dbMocks.getStaffById.mockResolvedValue({ account_scope: 'accounts' });
    dbMocks.getStaffAccountScopeIds.mockResolvedValue(['account-1']);
    const response = await app().request('/api/dashboard/delivery-failure-origins?account_id=account-2', {}, env());
    expect(response.status).toBe(404);
    expect(dbMocks.getDeliveryFailureOrigins).not.toHaveBeenCalled();
  });

  test('読めない日時は400', async () => {
    const response = await app().request(
      '/api/dashboard/delivery-failure-origins?account_id=account-1&since=not-a-date', {}, env());
    expect(response.status).toBe(400);
    expect(dbMocks.getDeliveryFailureOrigins).not.toHaveBeenCalled();
  });

  test('既定は日本時間の今日0:00から数える', async () => {
    const response = await app().request(
      '/api/dashboard/delivery-failure-origins?account_id=account-1', {}, env());
    expect(response.status).toBe(200);
    const [, arg] = dbMocks.getDeliveryFailureOrigins.mock.calls[0] as [{}, { since: string }];
    expect(arg.since).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+09:00$/);
  });
});
