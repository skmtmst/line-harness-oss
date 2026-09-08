import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// 画面のまとめタブ(処理中・失敗)をサーバ側で絞る statusGroup(#517 中1)。
const dbMocks = vi.hoisted(() => ({
  listEcOrders: vi.fn(),
  listEcActionExecutions: vi.fn(),
  listEcIdentityCandidates: vi.fn(),
  retryEcActionExecution: vi.fn(),
}));
const canAccess = vi.hoisted(() => vi.fn());

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: canAccess }));

const { ecOperations } = await import('./ec-operations.js');

const DB = {} as D1Database;

function app(role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当者', role, readOnly: false,
      tenantId: 'tenant-1', permissionKeys,
    });
    await next();
  });
  instance.route('/', ecOperations);
  return instance;
}

function request(path: string) {
  return app('owner').fetch(new Request(`https://example.com${path}`), { DB } as Env['Bindings']);
}

beforeEach(() => {
  vi.clearAllMocks();
  canAccess.mockResolvedValue(true);
  dbMocks.listEcActionExecutions.mockResolvedValue({
    items: [], total: 0,
    summary: { pending: 0, processing: 0, succeeded: 0, skipped: 0, retryable_failed: 0, permanent_failed: 0 },
  });
});

describe('EC action executions statusGroup', () => {
  it('failed group filters both failure states server-side', async () => {
    const response = await request('/api/ec-commerce/action-executions?lineAccountId=account-1&statusGroup=failed&limit=20&offset=20');
    expect(response.status).toBe(200);
    expect(dbMocks.listEcActionExecutions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lineAccountId: 'account-1',
      statuses: ['retryable_failed', 'permanent_failed'],
      limit: 20, offset: 20,
    }));
  });

  it('processing group filters pending and processing server-side', async () => {
    const response = await request('/api/ec-commerce/action-executions?lineAccountId=account-1&statusGroup=processing');
    expect(response.status).toBe(200);
    expect(dbMocks.listEcActionExecutions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      statuses: ['pending', 'processing'],
    }));
  });

  it('unknown statusGroup is rejected', async () => {
    const response = await request('/api/ec-commerce/action-executions?lineAccountId=account-1&statusGroup=everything');
    expect(response.status).toBe(400);
    expect(dbMocks.listEcActionExecutions).not.toHaveBeenCalled();
  });

  it('single status keeps working', async () => {
    const response = await request('/api/ec-commerce/action-executions?lineAccountId=account-1&status=succeeded');
    expect(response.status).toBe(200);
    expect(dbMocks.listEcActionExecutions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: 'succeeded', statuses: null,
    }));
  });
});
