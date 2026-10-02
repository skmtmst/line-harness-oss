import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

vi.mock('../services/account-access.js', () => accountAccessMocks);

const dbMocks = {
  getScenarioById: vi.fn(),
  listMoveReferrers: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { scenarios: scenariosModule } = await import('./scenarios.js');

function setupApp(
  role: 'owner' | 'admin' | 'staff' = 'owner',
  permissionKeys: string[] = ['/scenarios'],
) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = {} as Env['Bindings'];
    c.set('staff', {
      id: 'owner-1',
      name: '管理者',
      role,
      readOnly: false,
      tenantId: 'tenant-1',
      permissionKeys,
      assignedLineAccountId: null,
      canAccessDescendantAccounts: true,
    });
    await next();
  });
  app.route('/', scenariosModule);
  return app;
}

beforeEach(() => {
  dbMocks.getScenarioById.mockReset();
  dbMocks.listMoveReferrers.mockReset();
  accountAccessMocks.canAccessAllLineAccounts.mockReset().mockResolvedValue(true);
  accountAccessMocks.getVisibleLineAccountScope.mockReset().mockResolvedValue({
    allowedAccountIds: ['acc-1'],
    canSeeUnassigned: true,
  });
});

describe('GET /api/scenarios/:id/move-referrers（R250）', () => {
  test('見える範囲の参照元だけを名前つきで返す', async () => {
    dbMocks.getScenarioById.mockResolvedValue({ id: 'b', name: 'B' });
    dbMocks.listMoveReferrers.mockResolvedValue([
      { id: 'a1', name: 'A1', lineAccountId: 'acc-1' },
      { id: 'a2', name: 'A2', lineAccountId: 'acc-2' },
      { id: 'a3', name: 'A3', lineAccountId: null },
    ]);
    const app = setupApp();
    const res = await app.request('/api/scenarios/b/move-referrers');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        items: [
          { id: 'a1', name: 'A1' },
          { id: 'a3', name: 'A3' },
        ],
        total: 2,
      },
    });
  });

  test('無いシナリオは404', async () => {
    dbMocks.getScenarioById.mockResolvedValue(null);
    const app = setupApp();
    const res = await app.request('/api/scenarios/nope/move-referrers');
    expect(res.status).toBe(404);
  });

  test('権限が無いと403', async () => {
    dbMocks.getScenarioById.mockResolvedValue({ id: 'b', name: 'B' });
    const app = setupApp('staff', []);
    const res = await app.request('/api/scenarios/b/move-referrers');
    expect(res.status).toBe(403);
  });
});
