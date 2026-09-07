import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

vi.mock('../services/account-access.js', () => accountAccessMocks);

const dbMocks = {
  getScenarios: vi.fn(),
  getScenarioById: vi.fn(),
  createScenario: vi.fn(),
  updateScenario: vi.fn(),
  deleteScenario: vi.fn(),
  createScenarioStep: vi.fn(),
  updateScenarioStep: vi.fn(),
  deleteScenarioStep: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getFriendById: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

vi.mock('../services/scenario-stats.js', () => ({
  computeScenarioStats: vi.fn(),
}));

const { scenarios: scenariosModule } = await import('./scenarios.js');

function setupApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', {
      id: 'owner-1',
      name: '管理者',
      role: 'owner',
      readOnly: false,
      tenantId: 'tenant-1',
      permissionKeys: ['/scenarios'],
      assignedLineAccountId: null,
      canAccessDescendantAccounts: true,
    });
    await next();
  });
  app.route('/', scenariosModule);
  return app;
}

const db = {} as D1Database;

function seed(
  scenario: { id: string; line_account_id: string | null },
  friend: { id: string; line_account_id: string | null; is_following: number },
) {
  dbMocks.getScenarioById.mockResolvedValue(scenario);
  dbMocks.getFriendById.mockResolvedValue(friend);
  dbMocks.enrollFriendInScenario.mockResolvedValue({
    id: 'enroll-1',
    friend_id: friend.id,
    scenario_id: scenario.id,
    current_step_order: 1,
    status: 'active',
    started_at: '2026-09-07T00:00:00.000Z',
    next_delivery_at: null,
    updated_at: '2026-09-07T00:00:00.000Z',
  });
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  accountAccessMocks.canAccessAllLineAccounts.mockReset().mockResolvedValue(true);
  accountAccessMocks.getVisibleLineAccountScope.mockReset().mockResolvedValue({
    allowedAccountIds: ['acc-1'],
    canSeeUnassigned: true,
  });
});

/**
 * 点検 #495 中12 の再発防止。
 *
 * 手動登録は本物の購読を作るのに、友だち側のアカウント確認と
 * ブロック中の確認が無かった。別アカウントの友だちを混ぜられ、
 * 届かない購読が積まれた。テスト送信と同じ境界にする。
 */
describe('POST /api/scenarios/:id/enroll/:friendId の友だち側境界', () => {
  test('別アカウントの友だちは422で止める', async () => {
    seed(
      { id: 's-1', line_account_id: 'acc-1' },
      { id: 'f-1', line_account_id: 'acc-2', is_following: 1 },
    );
    const res = await setupApp(db).request('/api/scenarios/s-1/enroll/f-1', { method: 'POST' });
    expect(res.status).toBe(422);
    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
  });

  test('ブロック中の友だちは422で止める', async () => {
    seed(
      { id: 's-1', line_account_id: 'acc-1' },
      { id: 'f-1', line_account_id: 'acc-1', is_following: 0 },
    );
    const res = await setupApp(db).request('/api/scenarios/s-1/enroll/f-1', { method: 'POST' });
    expect(res.status).toBe(422);
    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
  });

  test('担当外の友だちは存在を隠す（404）', async () => {
    seed(
      { id: 's-1', line_account_id: 'acc-1' },
      { id: 'f-1', line_account_id: 'acc-2', is_following: 1 },
    );
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const res = await setupApp(db).request('/api/scenarios/s-1/enroll/f-1', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
  });

  test('同じアカウントの購読中は201で登録する', async () => {
    seed(
      { id: 's-1', line_account_id: 'acc-1' },
      { id: 'f-1', line_account_id: 'acc-1', is_following: 1 },
    );
    const res = await setupApp(db).request('/api/scenarios/s-1/enroll/f-1', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(db, 'f-1', 's-1');
  });
});
