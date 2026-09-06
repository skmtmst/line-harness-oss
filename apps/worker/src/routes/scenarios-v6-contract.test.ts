import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../index.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
}));
const contractMocks = vi.hoisted(() => ({
  getScenarioRuns: vi.fn(),
  saveScenarioDraft: vi.fn(),
  simulateScenario: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
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
  reorderScenarios: vi.fn(),
  getScenarioTriggers: vi.fn(),
  addScenarioTrigger: vi.fn(),
  removeScenarioTrigger: vi.fn(),
}));

vi.mock('../services/account-access.js', () => accountAccessMocks);
vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/scenario-stats.js', () => ({ computeScenarioStats: vi.fn() }));
vi.mock('../services/scenario-v6-contract.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/scenario-v6-contract.js')>()),
  ...contractMocks,
}));

const { scenarios } = await import('./scenarios.js');
const { ScenarioContractError } = await import('../services/scenario-v6-contract.js');

type Role = 'owner' | 'admin' | 'staff';

function app(role: Role = 'owner', permissionKeys: string[] = ['/scenarios']) {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database } as Env['Bindings'];
    c.set('staff', {
      id: 'staff-1',
      name: '担当者',
      role,
      readOnly: false,
      tenantId: 'tenant-1',
      permissionKeys,
      assignedLineAccountId: null,
      canAccessDescendantAccounts: false,
    });
    await next();
  });
  hono.route('/', scenarios);
  return hono;
}

const json = (method: 'POST' | 'PUT', body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getScenarioById.mockResolvedValue({
    id: 'scenario-1', line_account_id: 'account-1', steps: [],
  });
  accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  contractMocks.simulateScenario.mockResolvedValue({
    sideEffects: false, audience: { matched: 0 }, steps: [],
  });
  contractMocks.getScenarioRuns.mockResolvedValue({
    summary: { active: 0, paused: 0, completed: 0, delivering: 0 },
    subscriptions: [], testSends: [], concurrentBroadcasts: [], steps: [],
  });
  contractMocks.saveScenarioDraft.mockResolvedValue({ version: 1, afterActions: [] });
});

describe('scenario V6 routes', () => {
  it('通常と空状態を成功応答で返す', async () => {
    const simulated = await app().request('/api/scenarios/scenario-1/simulate', json('POST', {
      lineAccountId: 'account-1',
    }));
    expect(simulated.status).toBe(200);
    expect(await simulated.json()).toMatchObject({ success: true, data: { sideEffects: false } });

    const runs = await app().request('/api/scenarios/scenario-1/runs?lineAccountId=account-1');
    expect(runs.status).toBe(200);
    expect(await runs.json()).toMatchObject({ success: true, data: { subscriptions: [] } });
  });

  it('DB失敗を500で返し、空状態に置き換えない', async () => {
    contractMocks.getScenarioRuns.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await app().request('/api/scenarios/scenario-1/runs?lineAccountId=account-1');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: 'シナリオの情報を処理できませんでした',
    });
  });

  it('権限の無いstaffは閲覧と更新を拒否する', async () => {
    const runs = await app('staff', []).request(
      '/api/scenarios/scenario-1/runs?lineAccountId=account-1',
    );
    expect(runs.status).toBe(403);

    const draft = await app('staff', ['/scenarios']).request(
      '/api/scenarios/scenario-1/draft',
      json('PUT', { lineAccountId: 'account-1', expectedVersion: 0, afterActions: [] }),
    );
    expect(draft.status).toBe(403);
    expect(contractMocks.saveScenarioDraft).not.toHaveBeenCalled();
  });

  it('権限があっても担当外のLINE公式アカウントは404で隠す', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const response = await app('staff', ['/scenarios']).request(
      '/api/scenarios/scenario-1/runs?lineAccountId=account-2',
    );
    expect(response.status).toBe(404);
    expect(contractMocks.getScenarioRuns).not.toHaveBeenCalled();
  });

  it('scenario.definition.editを持つstaffは下書きを保存できる', async () => {
    const response = await app('staff', ['scenario.definition.edit']).request(
      '/api/scenarios/scenario-1/draft',
      json('PUT', { lineAccountId: 'account-1', expectedVersion: 0, afterActions: [] }),
    );
    expect(response.status).toBe(200);
    expect(contractMocks.saveScenarioDraft).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scenarioId: 'scenario-1', lineAccountId: 'account-1', expectedVersion: 0,
    }));
  });

  it('別アカウントは404、古い版は409を保つ', async () => {
    contractMocks.simulateScenario.mockRejectedValueOnce(
      new ScenarioContractError('not_found', 'シナリオが見つかりません', 404),
    );
    const hidden = await app().request('/api/scenarios/scenario-1/simulate', json('POST', {
      lineAccountId: 'account-2',
    }));
    expect(hidden.status).toBe(404);

    contractMocks.saveScenarioDraft.mockRejectedValueOnce(
      new ScenarioContractError('version_conflict', '読み直してください', 409),
    );
    const conflict = await app().request('/api/scenarios/scenario-1/draft', json('PUT', {
      lineAccountId: 'account-1', expectedVersion: 1, afterActions: [],
    }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ success: false, code: 'version_conflict' });
  });
});
