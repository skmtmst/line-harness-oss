import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getStaffByApiKey: vi.fn().mockResolvedValue(null),
  getFriendById: vi.fn(),
  getMileageSummaryForFriend: vi.fn(),
  getMileageHistoryForFriend: vi.fn(),
  getMileageSelfInsights: vi.fn(),
  getMileageConnectedAccountsForFriend: vi.fn(),
  getFriends: vi.fn(),
  addTagToFriend: vi.fn(),
  removeTagFromFriend: vi.fn(),
  getFriendTags: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  jstNow: vi.fn(() => '2026-08-09T00:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);
const accountAccessMocks = {
  canAccessAllLineAccounts: vi.fn().mockResolvedValue(true),
  getVisibleLineAccountScope: vi.fn(),
};
vi.mock('../services/account-access.js', () => accountAccessMocks);

vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('../services/step-delivery.js', () => ({ buildMessage: vi.fn() }));

const { authMiddleware } = await import('../middleware/auth.js');
const { friends } = await import('./friends.js');
type Env = import('../index.js').Env;

const API_KEY = 'test-owner-key';
const env = {
  DB: {} as D1Database,
  API_KEY,
} as unknown as Env['Bindings'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', friends);
  return instance;
}

function call(path: string) {
  return app().request(path, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  }, env);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getStaffByApiKey.mockResolvedValue(null);
  accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccessMocks.getVisibleLineAccountScope.mockResolvedValue({ allowedAccountIds: ['account-1'] });
  dbMocks.getMileageSelfInsights.mockResolvedValue({ accountCount: 1 });
  dbMocks.getMileageConnectedAccountsForFriend.mockResolvedValue([]);
});

describe('GET /api/friends/:id/mileage', () => {
  it('returns a canonical wallet summary and recent history', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_account_id: 'account-1' });
    dbMocks.getMileageSummaryForFriend.mockResolvedValue({
      programId: 'default',
      programName: 'Harnessマイル',
      available: 750,
      pending: 100,
      lifetimeEarned: 850,
      spent: 0,
    });
    dbMocks.getMileageHistoryForFriend.mockResolvedValue([
      {
        id: 'entry-1',
        entryType: 'grant',
        status: 'available',
        amount: 750,
        reason: '紹介成果承認',
        source: 'affiliate_conversion',
        sourceEventId: 'ce-1',
        occurredAt: '2026-08-09T12:00:00.000+09:00',
      },
    ]);

    const res = await call('/api/friends/friend-1/mileage?limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        summary: { available: number };
        history: Array<{ amount: number }>;
        insights: { accountCount: number };
      };
    };
    expect(body.data.summary.available).toBe(750);
    expect(body.data.history[0].amount).toBe(750);
    expect(body.data.insights.accountCount).toBe(1);
    expect(dbMocks.getMileageSummaryForFriend).toHaveBeenCalledWith(env.DB, 'friend-1');
    expect(dbMocks.getMileageHistoryForFriend).toHaveBeenCalledWith(
      env.DB,
      'friend-1',
      { limit: 3 },
    );
    expect(dbMocks.getMileageConnectedAccountsForFriend).toHaveBeenCalledWith(
      env.DB, 'friend-1', ['account-1'],
    );
  });

  it('returns 404 without querying the wallet for an unknown friend', async () => {
    dbMocks.getFriendById.mockResolvedValue(null);
    const res = await call('/api/friends/missing/mileage');
    expect(res.status).toBe(404);
    expect(dbMocks.getMileageSummaryForFriend).not.toHaveBeenCalled();
    expect(dbMocks.getMileageHistoryForFriend).not.toHaveBeenCalled();
  });

  it('clamps a very large history limit to 100', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_account_id: 'account-1' });
    dbMocks.getMileageSummaryForFriend.mockResolvedValue({});
    dbMocks.getMileageHistoryForFriend.mockResolvedValue([]);
    const res = await call('/api/friends/friend-1/mileage?limit=9999');
    expect(res.status).toBe(200);
    expect(dbMocks.getMileageHistoryForFriend).toHaveBeenCalledWith(
      env.DB,
      'friend-1',
      { limit: 100 },
    );
  });

  it('does not open a friend from a different selected account', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_account_id: 'account-2' });
    const res = await call('/api/friends/friend-1/mileage?accountId=account-1');
    expect(res.status).toBe(404);
    expect(dbMocks.getMileageSummaryForFriend).not.toHaveBeenCalled();
  });
});
