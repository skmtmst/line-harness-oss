import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({ canAccess: vi.fn() }));
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));

const { trafficPools } = await import('./traffic-pools.js');

function statement(results: unknown[]) {
  const value = { bind: vi.fn(), all: vi.fn(async () => ({ results })) };
  value.bind.mockReturnValue(value);
  return value;
}

describe('GET /api/traffic-pools/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canAccess.mockResolvedValue(true);
  });

  it('複数プールの所属アカウントを2クエリでまとめて返す', async () => {
    const pools = statement([
      { id: 'pool-1', active_account_id: 'account-1' },
      { id: 'pool-2', active_account_id: 'account-2' },
    ]);
    const accounts = statement([
      { id: 'pa-1', pool_id: 'pool-1', line_account_id: 'account-1', is_active: 1, created_at: '2026-09-08', account_name: 'A店', liff_id: null },
      { id: 'pa-2', pool_id: 'pool-2', line_account_id: 'account-2', is_active: 1, created_at: '2026-09-08', account_name: 'B店', liff_id: null },
    ]);
    const prepare = vi.fn().mockReturnValueOnce(pools).mockReturnValueOnce(accounts);
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
      await next();
    });
    app.route('/', trafficPools);

    const response = await app.request('/api/traffic-pools/accounts?ids=pool-1,pool-2', {}, {
      DB: { prepare } as unknown as D1Database,
    } as Env['Bindings']);

    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({ data: [
      { poolId: 'pool-1', accounts: [{ lineAccountId: 'account-1', accountName: 'A店' }] },
      { poolId: 'pool-2', accounts: [{ lineAccountId: 'account-2', accountName: 'B店' }] },
    ] });
  });
});
