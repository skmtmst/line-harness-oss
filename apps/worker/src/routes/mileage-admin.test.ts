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
  getMileageManualAdjustmentPolicy: vi.fn(),
  setMileageManualAdjustmentPolicy: vi.fn(),
  postMileageAdjustment: vi.fn(),
  getActionScoreOverview: vi.fn(),
  getActionScoreBands: vi.fn().mockResolvedValue({ min: 0, max: 100, normalMin: 30, highMin: 70 }),
  createMileageRewardDraft: vi.fn(),
  createMileageRewardDraftFromPublished: vi.fn(),
  getMileageReward: vi.fn(),
  getMileageRewardAdminOverview: vi.fn(),
  getMileageRedemption: vi.fn(),
  importMileageRewardCodes: vi.fn(),
  publishMileageReward: vi.fn(),
  reorderMileageRewards: vi.fn(),
  reserveMileageRewardRedemption: vi.fn(),
  setMileageRewardStatus: vi.fn(),
  updateMileageRewardDraft: vi.fn(),
  encryptCredential: vi.fn(),
  MileageRewardError: class MileageRewardError extends Error {
    constructor(public readonly code: string, message: string, public readonly status = 400) {
      super(message);
    }
  },
  MileageAdjustmentError: class MileageAdjustmentError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
};
vi.mock('@line-crm/db', () => dbMocks);

const deliveryMocks = { deliverMileageReward: vi.fn() };
vi.mock('../services/mileage-reward-delivery.js', () => deliveryMocks);

const accountAccessMocks = {
  getVisibleLineAccountScope: vi.fn(),
};
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { authMiddleware } = await import('../middleware/auth.js');
const { scoring } = await import('./scoring.js');
type Env = import('../index.js').Env;

const d1 = {
  prepare: vi.fn(),
};
const env = { DB: d1 as unknown as D1Database, API_KEY: 'owner-key' } as unknown as Env['Bindings'];

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
  dbMocks.getMileageManualAdjustmentPolicy.mockResolvedValue({ approvalThreshold: 10_000 });
  d1.prepare.mockImplementation(() => ({
    bind: () => ({ first: vi.fn().mockResolvedValue({ id: 'friend-1' }) }),
  }));
  accountAccessMocks.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'], canSeeUnassigned: false, ids: ['account-1'], accounts: [],
  });
  dbMocks.getMileageRewardAdminOverview.mockResolvedValue({ rewards: [], summary: {} });
  deliveryMocks.deliverMileageReward.mockResolvedValue({
    status: 'succeeded', rewardName: '交換品', customerMessage: '', rewardCode: null,
    retryAt: null, failurePolicy: 'retry', message: null,
  });
});

describe('mileage admin API', () => {
  it('keeps the reward list inside the selected account boundary', async () => {
    expect((await call('/api/mileage/rewards?accountId=account-1')).status).toBe(200);
    expect(dbMocks.getMileageRewardAdminOverview).toHaveBeenCalledWith(env.DB, 'account-1');

    accountAccessMocks.getVisibleLineAccountScope.mockResolvedValueOnce({
      allowedAccountIds: ['account-1'], canSeeUnassigned: false, ids: ['account-1'], accounts: [],
    });
    expect((await call('/api/mileage/rewards?accountId=hidden')).status).toBe(404);
    expect(dbMocks.getMileageRewardAdminOverview).toHaveBeenCalledTimes(1);
  });

  it('supports the canonical PATCH draft and POST stop contracts', async () => {
    dbMocks.updateMileageRewardDraft.mockResolvedValueOnce({ id: 'reward-1' });
    const draft = await call('/api/mileage/rewards/reward-1/draft', {
      method: 'PATCH',
      body: JSON.stringify({
        accountId: 'account-1', expectedVersionId: 'version-1',
        draft: { name: '交換品', rewardKind: 'coupon', requiredMiles: 300 },
      }),
    });
    expect(draft.status).toBe(200);
    expect(dbMocks.updateMileageRewardDraft).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      id: 'reward-1', lineAccountId: 'account-1', expectedVersionId: 'version-1',
    }));

    dbMocks.setMileageRewardStatus.mockResolvedValueOnce({ id: 'reward-1', status: 'stopped' });
    const stopped = await call('/api/mileage/rewards/reward-1/stop', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(stopped.status).toBe(200);
    expect(dbMocks.setMileageRewardStatus).toHaveBeenCalledWith(env.DB, {
      id: 'reward-1', lineAccountId: 'account-1', status: 'stopped',
    });
  });

  it('requires explicit confirmation before publishing a reward', async () => {
    const request = {
      method: 'POST',
      body: JSON.stringify({ accountId: 'account-1' }),
    } satisfies RequestInit;
    expect((await call('/api/mileage/rewards/reward-1/publish', request)).status).toBe(428);
    expect(dbMocks.publishMileageReward).not.toHaveBeenCalled();

    dbMocks.publishMileageReward.mockResolvedValueOnce({ id: 'reward-1', status: 'published' });
    const response = await call('/api/mileage/rewards/reward-1/publish', {
      ...request,
      headers: { 'X-Confirm-Irreversible': 'mileage-reward-publish' },
    });
    expect(response.status).toBe(200);
    expect(dbMocks.publishMileageReward).toHaveBeenCalledWith(env.DB, {
      id: 'reward-1', lineAccountId: 'account-1', publishedBy: 'env-owner',
    });
  });

  it('deduplicates and encrypts exchange codes before saving them', async () => {
    dbMocks.encryptCredential
      .mockResolvedValueOnce('encrypted-a')
      .mockResolvedValueOnce('encrypted-b');
    dbMocks.importMileageRewardCodes.mockResolvedValueOnce({ imported: 2, duplicates: 0 });

    const response = await call('/api/mileage/rewards/reward-1/codes', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'account-1', codes: [' CODE-A ', 'CODE-A', 'CODE-B'] }),
    });

    expect(response.status).toBe(201);
    expect(dbMocks.encryptCredential).toHaveBeenCalledTimes(2);
    expect(dbMocks.encryptCredential).toHaveBeenNthCalledWith(1, 'CODE-A', undefined);
    expect(dbMocks.encryptCredential).toHaveBeenNthCalledWith(2, 'CODE-B', undefined);
    expect(dbMocks.importMileageRewardCodes).toHaveBeenCalledWith(env.DB, {
      rewardId: 'reward-1',
      lineAccountId: 'account-1',
      codes: [
        { ciphertext: 'encrypted-a', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { ciphertext: 'encrypted-b', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
      ],
    });
    expect(await response.text()).not.toContain('CODE-A');
  });

  it('tests a reward without writing mileage or inventory', async () => {
    dbMocks.getMileageReward.mockResolvedValueOnce({
      id: 'reward-1', rewardKind: 'coupon', availableCodeCount: 0,
      currentVersion: { id: 'version-1', requiredMiles: 300 },
    });
    const response = await call('/api/mileage/rewards/reward-1/test', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { rewardId: 'reward-1', canDeliver: false, ledgerChanged: false },
    });
    expect(dbMocks.reserveMileageRewardRedemption).not.toHaveBeenCalled();
    expect(deliveryMocks.deliverMileageReward).not.toHaveBeenCalled();
  });

  it('requires confirmation and returns a safe result for an operator redemption', async () => {
    const request = {
      method: 'POST',
      headers: { 'Idempotency-Key': '11111111-2222-4333-8444-555555555555' },
      body: JSON.stringify({ accountId: 'account-1', friendId: 'friend-1', rewardId: 'reward-1' }),
    } satisfies RequestInit;
    expect((await call('/api/mileage/redemptions', request)).status).toBe(428);
    expect(dbMocks.reserveMileageRewardRedemption).not.toHaveBeenCalled();

    dbMocks.reserveMileageRewardRedemption.mockResolvedValueOnce({
      kind: 'created',
      redemption: {
        id: 'redemption-1', lineAccountId: 'account-1', idempotencyKey: 'secret-key',
        requestFingerprint: 'secret-fingerprint', status: 'reserved',
      },
    });
    const response = await call('/api/mileage/redemptions', {
      ...request,
      headers: { ...request.headers, 'X-Confirm-Irreversible': 'mileage-redemption' },
    });
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain('secret-key');
    expect(text).not.toContain('secret-fingerprint');
    expect(dbMocks.reserveMileageRewardRedemption).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: 'reward-1',
    }));
  });

  it('does not expose or retry another account redemption', async () => {
    dbMocks.getMileageRedemption.mockResolvedValue({
      id: 'redemption-hidden', lineAccountId: 'hidden', idempotencyKey: 'key', requestFingerprint: 'fp',
    });
    expect((await call('/api/mileage/redemptions/redemption-hidden?accountId=account-1')).status).toBe(404);
    const retry = await call('/api/mileage/redemptions/redemption-hidden/retry-fulfillment', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(retry.status).toBe(404);
    expect(deliveryMocks.deliverMileageReward).not.toHaveBeenCalled();
  });

  it('maps insufficient mileage and out-of-stock exchange failures without a 500', async () => {
    for (const code of ['insufficient_miles', 'out_of_stock']) {
      dbMocks.reserveMileageRewardRedemption.mockRejectedValueOnce(
        new dbMocks.MileageRewardError(code, code === 'insufficient_miles'
          ? '交換に必要なマイルが足りません'
          : '交換コードの在庫がありません', 409),
      );
      const response = await call('/api/mileage/redemptions', {
        method: 'POST',
        headers: {
          'Idempotency-Key': code === 'insufficient_miles'
            ? '11111111-2222-4333-8444-555555555555'
            : 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          'X-Confirm-Irreversible': 'mileage-redemption',
        },
        body: JSON.stringify({ accountId: 'account-1', friendId: 'friend-1', rewardId: 'reward-1' }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code });
    }
  });

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

  it('returns account-scoped action scores with bounded filters', async () => {
    dbMocks.getActionScoreOverview.mockResolvedValue({
      summary: { scoredFriends: 2, high: 1, normal: 0, low: 1, decreased30d: 1, highMin: 70, normalMin: 30 },
      items: [], pagination: { total: 2, limit: 100, offset: 0 },
    });
    const response = await call('/api/action-scores/friends?accountId=account-1&filter=decreased&sort=change_asc&limit=999');
    expect(response.status).toBe(200);
    expect(dbMocks.getActionScoreOverview).toHaveBeenCalledWith(env.DB, {
      accountId: 'account-1', search: '', filter: 'decreased', sort: 'change_asc', limit: 100, offset: 0,
      highMin: 70, normalMin: 30,
    });
  });

  it('rejects hidden accounts and unknown action-score filters', async () => {
    expect((await call('/api/action-scores/friends?accountId=hidden')).status).toBe(404);
    expect((await call('/api/action-scores/friends?accountId=account-1&filter=vip')).status).toBe(400);
    expect(dbMocks.getActionScoreOverview).not.toHaveBeenCalled();
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

  it('requires an explicit confirmation and a configured high-value policy', async () => {
    const request = {
      method: 'POST',
      headers: { 'Idempotency-Key': '11111111-2222-4333-8444-555555555555' },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'increase', amount: 100,
        reasonCategory: 'customer_support', reason: '電話対応のお礼',
      }),
    } satisfies RequestInit;
    expect((await call('/api/mileage/adjustments', request)).status).toBe(428);

    dbMocks.getMileageManualAdjustmentPolicy.mockResolvedValueOnce(null);
    const response = await call('/api/mileage/adjustments', {
      ...request,
      headers: { ...request.headers, 'X-Confirm-Irreversible': 'mileage-adjustment' },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'ADJUSTMENT_POLICY_REQUIRED' });
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();
  });

  it('appends a confirmed low-value adjustment with a stable idempotency key', async () => {
    dbMocks.postMileageAdjustment.mockResolvedValue({
      entry: { id: 'entry-1', amount: -250 }, balanceBefore: 1_000, balanceAfter: 750, replayed: false,
    });
    const response = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'decrease', amount: 250,
        reasonCategory: 'order_correction', reason: '注文取消分', sourceReferenceId: 'ORDER-1',
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { entryId: 'entry-1', balanceBefore: 1_000, amount: -250, balanceAfter: 750, replayed: false },
    });
    expect(dbMocks.postMileageAdjustment).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      friendId: 'friend-1', amount: -250, idempotencyKey: '11111111-2222-4333-8444-555555555555',
      lineAccountId: 'account-1', executedByStaffId: 'env-owner',
    }));
  });

  it('allows an admin to adjust mileage but rejects staff even with mileage visibility', async () => {
    dbMocks.postMileageAdjustment.mockResolvedValue({
      entry: { id: 'entry-admin', amount: 100 }, balanceBefore: 0, balanceAfter: 100, replayed: false,
    });
    dbMocks.getStaffByApiKey.mockResolvedValueOnce({
      id: 'admin-1', name: '管理者', role: 'admin', access_level: 'full', permission_keys: '[]',
      assigned_line_account_id: 'account-1', can_access_descendant_accounts: 0,
    });
    const admin = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-key',
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'increase', amount: 100,
        reasonCategory: 'customer_support', reason: '問い合わせ対応',
      }),
    });
    expect(admin.status).toBe(201);
    expect(dbMocks.postMileageAdjustment).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      executedByStaffId: 'admin-1', executedByStaffName: '管理者',
    }));

    vi.clearAllMocks();
    dbMocks.getStaffByApiKey.mockResolvedValueOnce({
      id: 'staff-1', name: '担当者', role: 'staff', access_level: 'full', permission_keys: '["/mileage"]',
      assigned_line_account_id: 'account-1', can_access_descendant_accounts: 0,
    });
    const staff = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer staff-key',
        'Idempotency-Key': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'increase', amount: 100,
        reasonCategory: 'customer_support', reason: '問い合わせ対応',
      }),
    });
    expect(staff.status).toBe(403);
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();
  });

  it('rejects invalid idempotency keys and maps insufficient balance safely', async () => {
    const invalid = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': 'not-a-uuid',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'decrease', amount: 1,
        reasonCategory: 'grant_correction', reason: '誤付与の訂正',
      }),
    });
    expect(invalid.status).toBe(400);
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();

    dbMocks.postMileageAdjustment.mockRejectedValueOnce(
      new dbMocks.MileageAdjustmentError('insufficient_balance'),
    );
    const insufficient = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'decrease', amount: 1,
        reasonCategory: 'grant_correction', reason: '誤付与の訂正',
      }),
    });
    expect(insufficient.status).toBe(400);
    expect(await insufficient.json()).toMatchObject({ code: 'insufficient_balance' });
  });

  it('blocks high-value and cross-account adjustments before writing the ledger', async () => {
    dbMocks.getMileageManualAdjustmentPolicy.mockResolvedValueOnce({ approvalThreshold: 500 });
    const high = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'increase', amount: 500,
        reasonCategory: 'campaign', reason: 'キャンペーン調整',
      }),
    });
    expect(high.status).toBe(400);
    expect(await high.json()).toMatchObject({ code: 'OWNER_APPROVAL_REQUIRED' });

    d1.prepare.mockImplementationOnce(() => ({
      bind: () => ({ first: vi.fn().mockResolvedValue(null) }),
    }));
    const hidden = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-hidden', direction: 'increase', amount: 10,
        reasonCategory: 'other', reason: '確認',
      }),
    });
    expect(hidden.status).toBe(404);
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();
  });

  it('lets only owners configure the approval threshold', async () => {
    const owner = await call('/api/mileage/adjustment-policy', {
      method: 'PUT', body: JSON.stringify({ accountId: 'account-1', approvalThreshold: 5_000 }),
    });
    expect(owner.status).toBe(200);
    expect(dbMocks.setMileageManualAdjustmentPolicy).toHaveBeenCalledWith(env.DB, 'account-1', {
      approvalThreshold: 5_000,
    });

    dbMocks.getStaffByApiKey.mockResolvedValueOnce({
      id: 'admin-1', name: '管理者', role: 'admin', access_level: 'full', permission_keys: '[]',
      assigned_line_account_id: 'account-1', can_access_descendant_accounts: 0,
    });
    const admin = await call('/api/mileage/adjustment-policy', {
      method: 'PUT',
      headers: { Authorization: 'Bearer admin-key' },
      body: JSON.stringify({ accountId: 'account-1', approvalThreshold: 1_000 }),
    });
    expect(admin.status).toBe(403);
  });
});
