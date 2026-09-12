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
  publishScenarioVersion: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

vi.mock('../services/scenario-stats.js', () => ({
  computeScenarioStats: vi.fn(),
}));

const { scenarios: scenariosModule } = await import('./scenarios.js');

function setupApp(db: D1Database, role: 'owner' | 'admin' | 'staff') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', {
      id: 'owner-1',
      name: '管理者',
      role,
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

const publishedVersion = {
  id: 'version-1',
  scenario_id: 's-1',
  version_number: 1,
  published_at: '2026-09-08T00:00:00.000+09:00',
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  accountAccessMocks.canAccessAllLineAccounts.mockReset().mockResolvedValue(true);
  accountAccessMocks.getVisibleLineAccountScope.mockReset().mockResolvedValue({
    allowedAccountIds: ['acc-1'],
    canSeeUnassigned: true,
  });
  dbMocks.getScenarioById.mockResolvedValue({ id: 's-1', line_account_id: 'acc-1' });
  dbMocks.publishScenarioVersion.mockResolvedValue(publishedVersion);
});

/**
 * 票 #644（点検 #495 / N-050）の公開口の契約。
 *
 * 公開操作は配信へ直結するので、他アカウント・権限不足・確認キーなしを
 * 止め、再試行と連打で二重版を作らない（DB 側の冪等と対になる）。
 */
describe('POST /api/scenarios/:id/publish の契約', () => {
  test('正常公開は版番号を返し、確認キーをDBへ渡す', async () => {
    const res = await setupApp(db, 'owner').request('/api/scenarios/s-1/publish', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'publish-key-0001' },
    });
    const json = (await res.json()) as {
      success: boolean;
      data: { scenarioId: string; versionId: string; versionNumber: number };
    };

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      scenarioId: 's-1',
      versionId: 'version-1',
      versionNumber: 1,
    });
    expect(dbMocks.publishScenarioVersion).toHaveBeenCalledWith(db, 's-1', {
      staffId: 'owner-1',
      idempotencyKey: 'publish-key-0001',
    });
  });

  test('確認キーが無い公開は400で止める', async () => {
    const res = await setupApp(db, 'owner').request('/api/scenarios/s-1/publish', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    expect(dbMocks.publishScenarioVersion).not.toHaveBeenCalled();
  });

  test('他アカウントの公開は存在を隠す（404）', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);

    const res = await setupApp(db, 'owner').request('/api/scenarios/s-1/publish', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'publish-key-0002' },
    });

    expect(res.status).toBe(404);
    expect(dbMocks.publishScenarioVersion).not.toHaveBeenCalled();
  });

  test('権限不足の担当は403で止める', async () => {
    const res = await setupApp(db, 'staff').request('/api/scenarios/s-1/publish', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'publish-key-0003' },
    });

    expect(res.status).toBe(403);
    expect(dbMocks.publishScenarioVersion).not.toHaveBeenCalled();
  });

  test('同じ確認キーの別操作は409で止める', async () => {
    dbMocks.publishScenarioVersion.mockRejectedValue(new Error('SCENARIO_PUBLISH_KEY_CONFLICT'));

    const res = await setupApp(db, 'owner').request('/api/scenarios/s-1/publish', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'publish-key-0004' },
    });

    expect(res.status).toBe(409);
  });
});
