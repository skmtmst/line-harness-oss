import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getStaffByApiKey: vi.fn().mockResolvedValue(null),
  getMileageAdminOverview: vi.fn(),
  getMileageAdminHistory: vi.fn(),
  getMileageRules: vi.fn(),
  getMileageRuleById: vi.fn(),
  createMileageRule: vi.fn(),
  updateMileageRule: vi.fn(),
  deleteMileageRule: vi.fn(),
  getScoringRules: vi.fn(),
  getScoringRuleById: vi.fn(),
  createScoringRule: vi.fn(),
  updateScoringRule: vi.fn(),
  deleteScoringRule: vi.fn(),
  getFriendScore: vi.fn(),
  getFriendScoreHistory: vi.fn(),
  addScore: vi.fn(),
  applyMileageRulesForEvent: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const accountAccessMocks = {
  getVisibleLineAccountScope: vi.fn(),
};
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { authMiddleware } = await import('../middleware/auth.js');
const { scoring } = await import('./scoring.js');
type Env = import('../index.js').Env;

const env = { DB: {} as D1Database, API_KEY: 'owner-key' } as unknown as Env['Bindings'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', scoring);
  return instance;
}

function call(path: string, init?: RequestInit) {
  return app().request(path, {
    ...init,
    headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json', ...init?.headers },
  }, env);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getStaffByApiKey.mockResolvedValue(null);
  accountAccessMocks.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'], canSeeUnassigned: false, ids: ['account-1'], accounts: [],
  });
});

describe('mileage admin API', () => {
  it('queues a generic authenticated engagement event', async () => {
    dbMocks.applyMileageRulesForEvent.mockResolvedValue({ event: { id: 'event-1' }, granted: [], queued: true });
    const response = await call('/api/mileage/events', {
      method: 'POST',
      body: JSON.stringify({
        friendId: 'friend-1', eventType: 'community_lesson_completed',
        source: 'community', sourceEventId: 'lesson-1', subjectKey: 'lesson-A',
      }),
    });
    expect(response.status).toBe(202);
    expect(dbMocks.applyMileageRulesForEvent).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      friendId: 'friend-1', eventType: 'community_lesson_completed', source: 'community',
    }));
  });

  it('returns a cross-account overview with bounded pagination', async () => {
    dbMocks.getMileageAdminOverview.mockResolvedValue({
      summary: { totalMembers: 10, totalAvailable: 200, activeMembers30d: 4, totalActions: 30 },
      members: [],
      pagination: { total: 10, limit: 100, offset: 0 },
    });
    const response = await call('/api/mileage/overview?accountId=account-1&search=%E7%94%B0&limit=999');
    expect(response.status).toBe(200);
    expect(dbMocks.getMileageAdminOverview).toHaveBeenCalledWith(env.DB, {
      accountId: 'account-1', search: '田', limit: 100, offset: 0,
      visibleAccountIds: ['account-1'],
    });
    expect(accountAccessMocks.getVisibleLineAccountScope).toHaveBeenCalledWith(
      env.DB, expect.objectContaining({ role: 'owner' }),
    );
  });

  it('requires and authorizes the selected account before reading history', async () => {
    expect((await call('/api/mileage/history')).status).toBe(400);
    expect(dbMocks.getMileageAdminHistory).not.toHaveBeenCalled();

    accountAccessMocks.getVisibleLineAccountScope.mockResolvedValueOnce({
      allowedAccountIds: ['account-1'], canSeeUnassigned: false, ids: ['account-1'], accounts: [],
    });
    expect((await call('/api/mileage/history?accountId=hidden')).status).toBe(404);
    expect(dbMocks.getMileageAdminHistory).not.toHaveBeenCalled();
  });

  it('returns filtered mileage history with bounded pagination', async () => {
    dbMocks.getMileageAdminHistory.mockResolvedValue({
      items: [], pagination: { total: 0, limit: 100, offset: 0 },
    });
    const response = await call(
      '/api/mileage/history?accountId=account-1&entryType=grant&status=available&mode=automatic&from=2026-08-01&to=2026-08-31&limit=999',
    );
    expect(response.status).toBe(200);
    expect(dbMocks.getMileageAdminHistory).toHaveBeenCalledWith(env.DB, {
      accountId: 'account-1',
      visibleAccountIds: ['account-1'],
      search: '',
      entryType: 'grant',
      status: 'available',
      mode: 'automatic',
      from: '2026-08-01',
      to: '2026-08-31',
      limit: 100,
      offset: 0,
    });
  });

  it('rejects unknown mileage-history filters', async () => {
    const response = await call('/api/mileage/history?accountId=account-1&entryType=delete');
    expect(response.status).toBe(400);
    expect(dbMocks.getMileageAdminHistory).not.toHaveBeenCalled();
  });

  it('rejects invalid or reversed mileage-history dates', async () => {
    expect((await call('/api/mileage/history?accountId=account-1&from=2026-8-1')).status).toBe(400);
    expect((await call('/api/mileage/history?accountId=account-1&from=2026-09-01&to=2026-08-31')).status).toBe(400);
    expect(dbMocks.getMileageAdminHistory).not.toHaveBeenCalled();
  });

  it('serializes editable mileage rules', async () => {
    dbMocks.getMileageRules.mockResolvedValue([{
      id: 'rule-1', program_id: 'default', name: 'メッセージ送信', event_type: 'message_received',
      source: 'line', amount: 1, initial_status: 'available', conditions: '{"dailyCapActions":5}',
      is_active: 1, created_at: '2026-08-09', updated_at: '2026-08-09',
    }]);
    const response = await call('/api/mileage/rules');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ amount: number; conditions: { dailyCapActions: number } }> };
    expect(body.data[0]).toMatchObject({ amount: 1, conditions: { dailyCapActions: 5 } });
  });

  it('rejects a zero-mile rule update before touching D1', async () => {
    const response = await call('/api/mileage/rules/rule-1', {
      method: 'PUT', body: JSON.stringify({ amount: 0 }),
    });
    expect(response.status).toBe(400);
    expect(dbMocks.updateMileageRule).not.toHaveBeenCalled();
  });
});
