import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getActiveImpersonation: vi.fn(async () => null),
  getPlatformAdminByStaffId: vi.fn(async () => null),
  getPlatformAdminRecord: vi.fn(async () => null),
  getStaffByApiKey: vi.fn().mockResolvedValue(null),
  getFriendById: vi.fn(),
  getMileageAdminOverview: vi.fn(),
  getMileageAdminHistory: vi.fn(),
  getMileageEarningRulesV6: vi.fn(),
  getMileageFriendsV6: vi.fn(),
  getMileageHistoryPeriodSummary: vi.fn(),
  getMileageRewardReachMetrics: vi.fn(),
  saveMileageEarningRuleDraft: vi.fn(),
  getMileageRules: vi.fn(),
  getMileageRuleById: vi.fn(),
  createMileageRule: vi.fn(),
  updateMileageRule: vi.fn(),
  deleteMileageRule: vi.fn(),
  publishMileageEarningRule: vi.fn(),
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
  findCommittedMileageAdjustment: vi.fn(),
  getMileageAdjustmentNotificationRecord: vi.fn(),
  postMileageAdjustment: vi.fn(),
  confirmPendingMileageEntry: vi.fn(),
  voidMileageLedgerEntry: vi.fn(),
  createMileageAdjustmentApprovalRequest: vi.fn(),
  listMileageAdjustmentApprovalRequests: vi.fn(),
  approveMileageAdjustmentRequest: vi.fn(),
  rejectMileageAdjustmentRequest: vi.fn(),
  cancelMileageAdjustmentRequest: vi.fn(),
  testMileageEarningRuleDraft: vi.fn(),
  validateMileageEarningRuleDraft: vi.fn((draft: unknown) => draft),
  getActionScoreOverview: vi.fn(),
  getActionScoreBands: vi.fn().mockResolvedValue({ min: 0, max: 100, normalMin: 30, highMin: 70 }),
  createMileageRewardDraft: vi.fn(),
  createMileageRewardDraftFromPublished: vi.fn(),
  getMileageReward: vi.fn(),
  getMileageRewardAdminOverview: vi.fn(),
  getMileageRedemption: vi.fn(),
  isMileageRefundComplete: vi.fn(),
  refundMileageRewardRedemption: vi.fn(),
  listMileageRedemptions: vi.fn(),
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
  MileageV6Error: class MileageV6Error extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status = 422,
      public readonly field?: string,
    ) { super(message); }
  },
};
vi.mock('@line-crm/db', () => dbMocks);

const deliveryMocks = { deliverMileageReward: vi.fn() };
vi.mock('../services/mileage-reward-delivery.js', () => deliveryMocks);

const adjustmentNotificationMocks = {
  mileageAdjustmentMessage: vi.fn().mockReturnValue('通知本文'),
  sendMileageAdjustmentNotification: vi.fn(),
};
vi.mock('../services/mileage-adjustment-notification.js', () => adjustmentNotificationMocks);

const accountAccessMocks = {
  getVisibleLineAccountScope: vi.fn(),
  canAccessAllLineAccounts: vi.fn(),
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
  accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  dbMocks.deleteMileageRule.mockResolvedValue(1);
  dbMocks.getMileageRewardAdminOverview.mockResolvedValue({ rewards: [], summary: {} });
  dbMocks.getMileageRewardReachMetrics.mockResolvedValue([]);
  dbMocks.getMileageHistoryPeriodSummary.mockResolvedValue({ byType: [], totalAmount: 0, manualCount: 0 });
  adjustmentNotificationMocks.sendMileageAdjustmentNotification.mockResolvedValue({
    id: 'notification-1', status: 'sent', attemptCount: 1,
  });
  deliveryMocks.deliverMileageReward.mockResolvedValue({
    status: 'succeeded', rewardName: '交換品', customerMessage: '', rewardCode: null,
    retryAt: null, failurePolicy: 'retry', message: null,
  });
});

describe('mileage admin API', () => {
  it('keeps the reward list inside the selected account boundary', async () => {
    expect((await call('/api/mileage/rewards?accountId=account-1')).status).toBe(200);
    expect(dbMocks.getMileageRewardAdminOverview).toHaveBeenCalledWith(env.DB, 'account-1');
    expect(dbMocks.getMileageRewardReachMetrics).toHaveBeenCalledWith(env.DB, 'account-1');

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
        accountId: 'account-1', expectedVersionId: 'version-1', expectedRevision: 2,
        draft: {
          name: '交換品', rewardKind: 'coupon', requiredMiles: 300,
          targetConditions: { operator: 'AND', rules: [{ type: 'tag_exists', value: '会員' }] },
        },
      }),
    });
    expect(draft.status).toBe(200);
    expect(dbMocks.updateMileageRewardDraft).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      id: 'reward-1', lineAccountId: 'account-1', expectedVersionId: 'version-1', expectedRevision: 2,
      draft: expect.objectContaining({
        targetConditions: { operator: 'AND', rules: [{ type: 'tag_exists', value: '会員' }] },
      }),
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
      expectedVersionId: null, expectedRevision: null,
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

  it('lists redemptions needing attention by default without secrets', async () => {
    dbMocks.listMileageRedemptions.mockResolvedValueOnce({
      items: [{
        id: 'redemption-9', lineAccountId: 'account-1', rewardId: 'reward-1',
        rewardName: '500円引き', status: 'delivery_failed', attemptCount: 2,
        failureCode: 'reward_delivery_failed', failureMessage: '特典を渡せませんでした',
        updatedAt: '2026-09-07T01:02:03.000Z', createdAt: '2026-09-07T00:00:00.000Z',
        idempotencyKey: 'secret-key', requestFingerprint: 'secret-fingerprint',
      }],
      pagination: { total: 1, limit: 100, offset: 0 },
    });
    // R364: 既定は要対応（失敗中＋配送中）。照合待ちを一覧から消さない。
    const response = await call('/api/mileage/redemptions?accountId=account-1&limit=999');
    expect(response.status).toBe(200);
    expect(dbMocks.listMileageRedemptions).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1', status: 'needs_attention', limit: 100, offset: 0,
    });
    const body = await response.json() as {
      data: { items: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
    };
    expect(body.data.pagination).toMatchObject({ total: 1 });
    expect(body.data.items[0]).toMatchObject({
      id: 'redemption-9', status: 'delivery_failed', attemptCount: 2,
      failureMessage: '特典を渡せませんでした', updatedAt: '2026-09-07T01:02:03.000Z',
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain('secret-key');
    expect(text).not.toContain('secret-fingerprint');
  });

  it('keeps the redemption list inside the account boundary', async () => {
    expect((await call('/api/mileage/redemptions?accountId=hidden')).status).toBe(404);
    expect(dbMocks.listMileageRedemptions).not.toHaveBeenCalled();
    expect((await call('/api/mileage/redemptions?accountId=account-1&status=bogus')).status).toBe(400);
    expect(dbMocks.listMileageRedemptions).not.toHaveBeenCalled();
  });

  it('retries only a failed fulfillment and keeps the same redemption', async () => {
    dbMocks.getMileageRedemption.mockResolvedValue({
      id: 'redemption-9', lineAccountId: 'account-1', status: 'delivery_failed',
      idempotencyKey: 'secret-key-9', requestFingerprint: 'secret-fp-9',
    });
    deliveryMocks.deliverMileageReward.mockResolvedValueOnce({
      status: 'succeeded', rewardName: '500円引き', customerMessage: '',
      rewardCode: null, retryAt: null, failurePolicy: 'retry', message: null,
    });
    const response = await call('/api/mileage/redemptions/redemption-9/retry-fulfillment', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(response.status).toBe(200);
    expect(deliveryMocks.deliverMileageReward).toHaveBeenCalledTimes(1);
    expect(deliveryMocks.deliverMileageReward).toHaveBeenCalledWith(
      env.DB, 'redemption-9', expect.objectContaining({}),
    );
    // R367: 交換の今の状態も返す。画面は返却完了などを区別できる。
    const body = await response.json() as { data: { redemption: Record<string, unknown> } };
    expect(body.data.redemption).toMatchObject({ id: 'redemption-9', lineAccountId: 'account-1' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  /*
   * R364: 配送中（照合待ち）のやり直しも受け付ける。
   * 送ったか確かめられない手順は送り直さない（配送側の責務）。
   * （直す前は delivering が409＝赤）
   */
  it('retries a delivering redemption left unconfirmed without resending', async () => {
    dbMocks.getMileageRedemption.mockResolvedValue({
      id: 'redemption-hold', lineAccountId: 'account-1', status: 'delivering',
      idempotencyKey: 'key-hold', requestFingerprint: 'fp-hold',
    });
    deliveryMocks.deliverMileageReward.mockResolvedValueOnce({
      status: 'delivery_failed', rewardName: '500円引き', customerMessage: '',
      rewardCode: null, retryAt: null, failurePolicy: 'retry',
      message: '特典の送信は終わっています。確定を確認しています。',
    });
    const response = await call('/api/mileage/redemptions/redemption-hold/retry-fulfillment', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(response.status).toBe(202);
    expect(deliveryMocks.deliverMileageReward).toHaveBeenCalledWith(
      env.DB, 'redemption-hold', expect.objectContaining({}),
    );
    const body = await response.json() as { data: { redemption: Record<string, unknown> } };
    expect(body.data.redemption).toMatchObject({ id: 'redemption-hold' });
  });

  it('refuses to retry a redemption that is not failing', async () => {
    for (const status of ['reserved', 'succeeded']) {
      dbMocks.getMileageRedemption.mockResolvedValueOnce({
        id: `redemption-${status}`, lineAccountId: 'account-1', status,
      });
      const response = await call(`/api/mileage/redemptions/redemption-${status}/retry-fulfillment`, {
        method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'redemption_not_retryable' });
    }
    // R362: 書き込み済みの返却のやり直しも従来どおり409（二重返却なし）。
    dbMocks.getMileageRedemption.mockResolvedValueOnce({
      id: 'redemption-refunded', lineAccountId: 'account-1', status: 'refunded',
    });
    dbMocks.isMileageRefundComplete.mockResolvedValueOnce(true);
    const completed = await call('/api/mileage/redemptions/redemption-refunded/retry-fulfillment', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(completed.status).toBe(409);
    expect(await completed.json()).toMatchObject({ code: 'redemption_not_retryable' });
    expect(deliveryMocks.deliverMileageReward).not.toHaveBeenCalled();
    expect(dbMocks.refundMileageRewardRedemption).not.toHaveBeenCalled();
  });

  /*
   * R362: 返却確定後に書き込みが中断した交換のやり直しは、
   * 欠けた書き込みを足して202で返す（直す前は一律409で残高が戻らない＝赤）。
   */
  it('resumes a refunded redemption whose writes were interrupted', async () => {
    const stuck = { id: 'redemption-stuck', lineAccountId: 'account-1', status: 'refunded' };
    dbMocks.getMileageRedemption.mockResolvedValue(stuck);
    dbMocks.isMileageRefundComplete.mockResolvedValue(false);
    dbMocks.refundMileageRewardRedemption.mockResolvedValue({ ...stuck });
    deliveryMocks.deliverMileageReward.mockResolvedValueOnce({
      status: 'delivery_failed', rewardName: '交換品', customerMessage: '', rewardCode: null,
      retryAt: null, failurePolicy: 'refund', message: '交換したマイルは戻されています。',
    });
    const response = await call('/api/mileage/redemptions/redemption-stuck/retry-fulfillment', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(response.status).toBe(202);
    expect(dbMocks.refundMileageRewardRedemption).toHaveBeenCalledWith(
      expect.anything(), { redemptionId: 'redemption-stuck', reason: '中断した返却の再開' },
    );
    expect(deliveryMocks.deliverMileageReward).toHaveBeenCalledWith(
      expect.anything(), 'redemption-stuck', expect.objectContaining({}),
    );
    const body = await response.json() as { success: boolean; data: { redemption: { id: string } } };
    expect(body.success).toBe(false);
    expect(body.data.redemption).toMatchObject({ id: 'redemption-stuck' });
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

  it('returns account-scoped mileage friends and bounds the page size', async () => {
    dbMocks.getMileageFriendsV6.mockResolvedValue({
      summary: { totalMembers: 1, available: 300 }, items: [],
      pagination: { total: 1, limit: 100, offset: 0 }, measuredAt: '2026-09-07T00:00:00.000Z',
    });
    const response = await call('/api/mileage/friends?accountId=account-1&search=%E7%94%B0&limit=999');
    expect(response.status).toBe(200);
    expect(dbMocks.getMileageFriendsV6).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1', visibleAccountIds: ['account-1'], search: '田', limit: 100, offset: 0,
    });
  });

  it('lists earning rules and saves a versioned draft only for an authorized account', async () => {
    dbMocks.getMileageEarningRulesV6.mockResolvedValue({ items: [], pagination: { total: 0 } });
    expect((await call('/api/mileage/earning-rules?accountId=account-1&limit=999')).status).toBe(200);
    expect(dbMocks.getMileageEarningRulesV6).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1', limit: 100, offset: 0,
    });

    const draft = {
      name: '購入マイル', eventType: 'order_paid', source: 'ec', amount: 100,
      initialStatus: 'available', validFrom: null, validUntil: null,
      expiresAfterDays: 365, cancellationEventTypes: ['order_cancelled'],
      targetConditions: { operator: 'AND', rules: [{ type: 'tag_exists', value: '購入者' }] },
      sortOrder: 1,
      notification: {
        enabled: true,
        messageTemplate: '{awardedMiles}マイル付きました。残高は{balance}マイルです。',
      },
    };
    dbMocks.saveMileageEarningRuleDraft.mockResolvedValue({ ruleId: 'rule-1', version: 2, draft });
    const response = await call('/api/mileage/earning-rules/rule-1/draft', {
      method: 'PATCH', body: JSON.stringify({ accountId: 'account-1', expectedVersion: 1, draft }),
    });
    expect(response.status).toBe(200);
    expect(dbMocks.saveMileageEarningRuleDraft).toHaveBeenCalledWith(env.DB, {
      ruleId: 'rule-1', lineAccountId: 'account-1', expectedVersion: 1,
      draft, updatedByStaffId: 'env-owner',
    });
  });

  it('returns a conflict when an earning-rule draft is stale', async () => {
    dbMocks.saveMileageEarningRuleDraft.mockRejectedValueOnce(
      new dbMocks.MileageV6Error('version_conflict', '下書きを読み直してください', 409),
    );
    const response = await call('/api/mileage/earning-rules/rule-1/draft', {
      method: 'PATCH',
      body: JSON.stringify({ accountId: 'account-1', expectedVersion: 1, draft: {} }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'version_conflict' });
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

  it('WEB074 forwards multiple types before pagination and rejects invalid types', async () => {
    dbMocks.getMileageAdminHistory.mockResolvedValue({ items: [], pagination: { total: 4, limit: 2, offset: 2 } });
    const response = await call('/api/mileage/history?accountId=account-1&entryTypes=spend,reversal&limit=2&offset=2');
    expect(response.status).toBe(200);
    expect(dbMocks.getMileageAdminHistory).toHaveBeenCalledWith(env.DB, expect.objectContaining({ entryTypes: ['spend','reversal'], limit: 2, offset: 2 }));
    expect((await call('/api/mileage/history?accountId=account-1&entryTypes=spend,bogus')).status).toBe(400);
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
    expect(dbMocks.getMileageHistoryPeriodSummary).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1', from: '2026-08-01', to: '2026-08-31',
    });
    expect(await response.json()).toMatchObject({
      data: { summary: { totalAmount: 0, manualCount: 0 } },
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
    const base = {
      program_id: 'default', source: 'line', amount: 1, initial_status: 'available',
      conditions: '{"dailyCapActions":5}', is_active: 1,
      created_at: '2026-08-09', updated_at: '2026-08-09',
    };
    dbMocks.getMileageRules.mockResolvedValue([
      { ...base, id: 'rule-1', name: 'メッセージ送信', event_type: 'message_received', line_account_id: 'account-1' },
      { ...base, id: 'rule-other', name: '他店ルール', event_type: 'visit', line_account_id: 'account-other' },
      { ...base, id: 'legacy', name: '旧全店ルール', event_type: 'legacy', line_account_id: null },
    ]);
    const response = await call('/api/mileage/rules');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{
      id: string; amount: number; conditions: { dailyCapActions: number };
    }> };
    expect(body.data.map((rule) => rule.id)).toEqual(['rule-1']);
    expect(body.data[0]).toMatchObject({ amount: 1, conditions: { dailyCapActions: 5 } });
  });

  it('creates mileage rules only inside an authorized LINE account', async () => {
    const body = { name: '来店', eventType: 'visit', amount: 10 };
    expect((await call('/api/mileage/rules', {
      method: 'POST', body: JSON.stringify(body),
    })).status).toBe(400);

    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    expect((await call('/api/mileage/rules', {
      method: 'POST', body: JSON.stringify({ ...body, lineAccountId: 'account-other' }),
    })).status).toBe(403);
    expect(dbMocks.createMileageRule).not.toHaveBeenCalled();

    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
    dbMocks.createMileageRule.mockResolvedValue({
      id: 'rule-1', name: '来店', event_type: 'visit', amount: 10,
      line_account_id: 'account-1', initial_status: 'available', is_active: 1,
    });
    expect((await call('/api/mileage/rules', {
      method: 'POST', body: JSON.stringify({ ...body, lineAccountId: 'account-1' }),
    })).status).toBe(201);
    expect(dbMocks.createMileageRule).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      lineAccountId: 'account-1',
    }));
  });

  it.each(['PUT', 'DELETE'] as const)('%s cannot modify another account mileage rule', async (method) => {
    dbMocks.getMileageRuleById.mockResolvedValue({ id: 'rule-other', line_account_id: 'account-other' });
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const response = await call('/api/mileage/rules/rule-other', {
      method,
      ...(method === 'PUT' ? { body: JSON.stringify({ amount: 2 }) } : {}),
    });
    expect(response.status).toBe(404);
    expect(dbMocks.updateMileageRule).not.toHaveBeenCalled();
    expect(dbMocks.deleteMileageRule).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'DELETE'] as const)('%s cannot change a legacy global mileage rule', async (method) => {
    dbMocks.getMileageRuleById.mockResolvedValue({ id: 'legacy', line_account_id: null });
    const response = await call('/api/mileage/rules/legacy', {
      method,
      ...(method === 'PUT' ? { body: JSON.stringify({ amount: 2 }) } : {}),
    });
    expect(response.status).toBe(409);
  });

  it('DELETE refuses a rule with grant history (atomic delete returns 0)', async () => {
    dbMocks.getMileageRuleById.mockResolvedValue({ id: 'rule-1', line_account_id: 'account-1' });
    dbMocks.deleteMileageRule.mockResolvedValue(0);
    const first = await call('/api/mileage/rules/rule-1', { method: 'DELETE' });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ success: false });
    const second = await call('/api/mileage/rules/rule-1', { method: 'DELETE' });
    expect(second.status).toBe(409);
    expect(dbMocks.deleteMileageRule).toHaveBeenCalledWith(env.DB, 'rule-1');
  });

  it('DELETE removes a rule without history (atomic delete returns 1)', async () => {
    dbMocks.getMileageRuleById.mockResolvedValue({ id: 'rule-1', line_account_id: 'account-1' });
    dbMocks.deleteMileageRule.mockResolvedValue(1);
    const response = await call('/api/mileage/rules/rule-1', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(dbMocks.deleteMileageRule).toHaveBeenCalledWith(env.DB, 'rule-1');
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

  it('creates an expiration lot and reports automatic LINE notification delivery', async () => {
    dbMocks.postMileageAdjustment.mockResolvedValue({
      entry: { id: 'entry-expiring', amount: 300 }, balanceBefore: 100, balanceAfter: 400, replayed: false,
    });
    const expiresAt = '2099-12-31T15:00:00.000Z';
    const response = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'increase', amount: 300,
        reasonCategory: 'campaign', reason: '個別キャンペーン', expiresAt, notifyFriend: true,
      }),
    });
    expect(response.status).toBe(201);
    expect(dbMocks.postMileageAdjustment).toHaveBeenCalledWith(env.DB, expect.objectContaining({ expiresAt }));
    expect(adjustmentNotificationMocks.sendMileageAdjustmentNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lineAccountId: 'account-1', friendId: 'friend-1', ledgerEntryId: 'entry-expiring',
        idempotencyKey: '11111111-2222-4333-8444-555555555555', message: '通知本文',
      }),
    );
    expect(await response.json()).toMatchObject({
      data: { expiresAt, notification: { status: 'sent' } },
    });
  });

  it('keeps a completed adjustment successful when notification delivery infrastructure fails', async () => {
    dbMocks.postMileageAdjustment.mockResolvedValue({
      entry: { id: 'entry-notify-failed', amount: 50 }, balanceBefore: 100, balanceAfter: 150, replayed: false,
    });
    adjustmentNotificationMocks.sendMileageAdjustmentNotification.mockRejectedValueOnce(new Error('D1 unavailable'));
    const response = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'increase', amount: 50,
        reasonCategory: 'other', reason: '個別調整', notifyFriend: true,
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        entryId: 'entry-notify-failed',
        notification: { status: 'failed', errorCode: 'notification_record_failed' },
      },
    });
  });

  it('rejects expiration on a deduction before writing the ledger', async () => {
    const response = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'decrease', amount: 10,
        reasonCategory: 'other', reason: '訂正', expiresAt: '2099-12-31T15:00:00.000Z',
      }),
    });
    expect(response.status).toBe(400);
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();
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
    dbMocks.createMileageAdjustmentApprovalRequest.mockResolvedValueOnce({
      request: { id: 'req-1', status: 'pending' }, replayed: false,
    });
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
    // R: 境界以上は実行せず承認依頼を作る（台帳は書かない）
    expect(high.status).toBe(202);
    expect(await high.json()).toMatchObject({ data: { approvalRequired: true } });
    expect(dbMocks.createMileageAdjustmentApprovalRequest).toHaveBeenCalled();
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();

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

  /*
   * R378: 確定済みの調整を同じ内容で再送したときは、あとから変わった
   * 承認境界や経過した元の期限で拒否せず、当時の結果をそのまま返す。
   */
  it('replays a committed adjustment even after the approval threshold was lowered', async () => {
    dbMocks.findCommittedMileageAdjustment.mockResolvedValueOnce({
      entry: { id: 'entry-9', amount: 500 },
      balanceBefore: 100,
      balanceAfter: 600,
      replayed: true,
    });
    // 境界を 100 へ下げたあとの再送。新規判定なら承認依頼になる額。
    dbMocks.getMileageManualAdjustmentPolicy.mockResolvedValueOnce({ approvalThreshold: 100 });
    const response = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'increase', amount: 500,
        reasonCategory: 'campaign', reason: 'キャンペーン調整',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { entryId: 'entry-9', balanceBefore: 100, balanceAfter: 600, replayed: true },
    });
    expect(dbMocks.createMileageAdjustmentApprovalRequest).not.toHaveBeenCalled();
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a same-key retry whose content differs from the committed adjustment', async () => {
    dbMocks.findCommittedMileageAdjustment.mockRejectedValueOnce(
      new dbMocks.MileageAdjustmentError('idempotency_conflict'),
    );
    const response = await call('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify({
        accountId: 'account-1', friendId: 'friend-1', direction: 'increase', amount: 999,
        reasonCategory: 'campaign', reason: '別の内容',
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false, code: 'idempotency_conflict',
    });
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();
  });

  /*
   * R380/R381: 通知だけをあとから再送する口。残高は動かさず、保存済みの
   * 本文と送信キーで再送する。通知を依頼していない調整や、担当外の
   * アカウントの調整には使えない。
   */
  it('retries a stored notification without reapplying mileage', async () => {
    d1.prepare.mockImplementationOnce(() => ({
      bind: () => ({
        first: vi.fn().mockResolvedValue({
          id: 'entry-1', beneficiary_friend_id: 'friend-1', idempotency_key: 'key-1',
          amount: 100, metadata: JSON.stringify({ notifyFriend: true, balanceAfter: 600 }),
        }),
      }),
    }));
    dbMocks.getMileageAdjustmentNotificationRecord.mockResolvedValueOnce({
      id: 'notif-1', friendId: 'friend-1', ledgerEntryId: 'entry-1',
      idempotencyKey: 'notif-key-1', messageText: '保存済み本文',
    });
    const res = await call('/api/mileage/entries/entry-1/notification-retry', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(res.status).toBe(200);
    expect(adjustmentNotificationMocks.sendMileageAdjustmentNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lineAccountId: 'account-1',
        friendId: 'friend-1',
        ledgerEntryId: 'entry-1',
        idempotencyKey: 'notif-key-1',
        message: '保存済み本文',
      }),
    );
    expect(dbMocks.postMileageAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a retry for an adjustment that never requested a notification', async () => {
    d1.prepare.mockImplementationOnce(() => ({
      bind: () => ({
        first: vi.fn().mockResolvedValue({
          id: 'entry-2', beneficiary_friend_id: 'friend-1', idempotency_key: 'key-2',
          amount: 100, metadata: JSON.stringify({ notifyFriend: false }),
        }),
      }),
    }));
    const res = await call('/api/mileage/entries/entry-2/notification-retry', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(res.status).toBe(404);
    expect(adjustmentNotificationMocks.sendMileageAdjustmentNotification).not.toHaveBeenCalled();
  });

  it('rejects a retry for an entry outside the operator account scope', async () => {
    const res = await call('/api/mileage/entries/entry-9/notification-retry', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'account-2' }),
    });
    expect(res.status).toBe(404);
    expect(d1.prepare).not.toHaveBeenCalled();
    expect(adjustmentNotificationMocks.sendMileageAdjustmentNotification).not.toHaveBeenCalled();
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

  it('reads a visible friend score but hides other-account friends', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_account_id: 'account-1' });
    dbMocks.getFriendScore.mockResolvedValue(42);
    dbMocks.getFriendScoreHistory.mockResolvedValue([]);
    const visible = await call('/api/friends/friend-1/score');
    expect(visible.status).toBe(200);
    expect(dbMocks.getFriendScore).toHaveBeenCalledWith(env.DB, 'friend-1');

    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-2', line_account_id: 'account-2' });
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const hidden = await call('/api/friends/friend-2/score');
    expect(hidden.status).toBe(404);
    expect(dbMocks.getFriendScore).toHaveBeenCalledTimes(1);
  });

  it('adds a score only for a visible friend', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_account_id: 'account-1' });
    dbMocks.getFriendScore.mockResolvedValue(45);
    const added = await call('/api/friends/friend-1/score', {
      method: 'POST', body: JSON.stringify({ scoreChange: 3, reason: '対応記録' }),
    });
    expect(added.status).toBe(201);
    expect(dbMocks.addScore).toHaveBeenCalledWith(env.DB, {
      friendId: 'friend-1', scoreChange: 3, reason: '対応記録',
      // IDEA-17: 手で動かした点数は実行者を記録へ残す。
      executedByStaffId: 'env-owner', executedByStaffName: 'Owner',
    });

    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-2', line_account_id: 'account-2' });
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const hidden = await call('/api/friends/friend-2/score', {
      method: 'POST', body: JSON.stringify({ scoreChange: 3 }),
    });
    expect(hidden.status).toBe(404);
    expect(dbMocks.addScore).toHaveBeenCalledTimes(1);
  });
});

describe('mileage earning rule publish (N-231 案1)', () => {
  const publishKey = '11111111-2222-4333-8444-555555555555';
  const confirmHeaders = {
    'Idempotency-Key': publishKey,
    'X-Confirm-Irreversible': 'mileage-earning-rule-publish',
  };
  const publishBody = { accountId: 'account-1', expectedVersion: 2 };

  it('PUT refuses direct content edits but keeps stop/resume', async () => {
    dbMocks.getMileageRuleById.mockResolvedValue({ id: 'rule-1', line_account_id: 'account-1' });
    const refused = await call('/api/mileage/rules/rule-1', {
      method: 'PUT', body: JSON.stringify({ amount: 200 }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ success: false });
    expect(dbMocks.updateMileageRule).not.toHaveBeenCalled();

    dbMocks.updateMileageRule.mockResolvedValue({ id: 'rule-1' });
    const stopped = await call('/api/mileage/rules/rule-1', {
      method: 'PUT', body: JSON.stringify({ isActive: false }),
    });
    expect(stopped.status).toBe(200);
    expect(dbMocks.updateMileageRule).toHaveBeenCalledWith(env.DB, 'rule-1', { isActive: false });
  });

  it('publish requires the irreversible confirmation', async () => {
    const response = await call('/api/mileage/earning-rules/rule-1/publish', {
      method: 'POST',
      headers: { 'Idempotency-Key': publishKey },
      body: JSON.stringify(publishBody),
    });
    expect(response.status).toBe(428);
    expect(dbMocks.publishMileageEarningRule).not.toHaveBeenCalled();
  });

  it('publish requires a valid idempotency key and draft version', async () => {
    const badKey = await call('/api/mileage/earning-rules/rule-1/publish', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'short', 'X-Confirm-Irreversible': 'mileage-earning-rule-publish' },
      body: JSON.stringify(publishBody),
    });
    expect(badKey.status).toBe(400);
    const noVersion = await call('/api/mileage/earning-rules/rule-1/publish', {
      method: 'POST',
      headers: confirmHeaders,
      body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(noVersion.status).toBe(400);
    expect(dbMocks.publishMileageEarningRule).not.toHaveBeenCalled();
  });

  it('publish delegates to the atomic handler with account and version', async () => {
    dbMocks.publishMileageEarningRule.mockResolvedValue({
      ruleId: 'rule-1', versionId: 'version-1', versionNumber: 3, publishedAt: '2026-08-10T00:00:00.000+09:00',
    });
    const response = await call('/api/mileage/earning-rules/rule-1/publish', {
      method: 'POST', headers: confirmHeaders, body: JSON.stringify(publishBody),
    });
    expect(response.status).toBe(200);
    expect(dbMocks.publishMileageEarningRule).toHaveBeenCalledWith(env.DB, {
      ruleId: 'rule-1', lineAccountId: 'account-1', expectedVersion: 2,
      staffId: expect.any(String), idempotencyKey: publishKey,
    });
    expect(await response.json()).toMatchObject({ success: true, data: { versionNumber: 3 } });
  });

  it('publish surfaces a stale draft version as 409', async () => {
    dbMocks.publishMileageEarningRule.mockRejectedValue(
      new dbMocks.MileageV6Error('version_conflict', '下書きを読み直してください', 409),
    );
    const response = await call('/api/mileage/earning-rules/rule-1/publish', {
      method: 'POST', headers: confirmHeaders, body: JSON.stringify(publishBody),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false });
  });
});

describe('R: 確定待ち・承認・決めごとテストのルート', () => {
  it('確定は理由なしで400、ありなら台帳を進める', async () => {
    const missing = await call('/api/mileage/entries/entry-1/confirm', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: 'reason_required' });

    dbMocks.confirmPendingMileageEntry.mockResolvedValueOnce({
      entry: { id: 'entry-1', status: 'available' }, alreadyConfirmed: false,
    });
    const ok = await call('/api/mileage/entries/entry-1/confirm', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'account-1', reason: '来店確認' }),
    });
    expect(ok.status).toBe(200);
    expect(dbMocks.confirmPendingMileageEntry).toHaveBeenCalledWith(
      env.DB, expect.objectContaining({ entryId: 'entry-1', reason: '来店確認' }),
    );
  });

  it('取消は画面の確認手順と理由の両方が要る', async () => {
    const noConfirm = await call('/api/mileage/entries/entry-1/void', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'account-1', reason: 'キャンセル' }),
    });
    expect(noConfirm.status).toBe(428);
    const noReason = await call('/api/mileage/entries/entry-1/void', {
      method: 'POST',
      headers: { 'X-Confirm-Irreversible': 'mileage-entry-void' },
      body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(noReason.status).toBe(400);
    dbMocks.voidMileageLedgerEntry.mockResolvedValueOnce({
      entry: { id: 'entry-1', status: 'void' }, reversalEntryId: 'rev-1', replayed: false,
    });
    const ok = await call('/api/mileage/entries/entry-1/void', {
      method: 'POST',
      headers: { 'X-Confirm-Irreversible': 'mileage-entry-void' },
      body: JSON.stringify({ accountId: 'account-1', reason: '注文キャンセル' }),
    });
    expect(ok.status).toBe(200);
  });

  it('承認の一覧と承認実行を受け付ける', async () => {
    dbMocks.listMileageAdjustmentApprovalRequests.mockResolvedValueOnce([
      { id: 'req-1', status: 'pending', amount: 5000 },
    ]);
    const list = await call('/api/mileage/adjustment-approvals?accountId=account-1&status=pending');
    expect(list.status).toBe(200);
    expect(dbMocks.listMileageAdjustmentApprovalRequests).toHaveBeenCalledWith(
      env.DB, { lineAccountId: 'account-1', status: 'pending' },
    );

    dbMocks.approveMileageAdjustmentRequest.mockResolvedValueOnce({
      request: { id: 'req-1', status: 'approved' }, entry: { id: 'entry-9' },
    });
    const approve = await call('/api/mileage/adjustment-approvals/req-1/approve', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(approve.status).toBe(200);
    expect(await approve.json()).toMatchObject({ data: { entryId: 'entry-9' } });
  });

  it('決めごとテストは下書きを検証してから試す', async () => {
    dbMocks.testMileageEarningRuleDraft.mockResolvedValueOnce({
      matchedEvents: 2, matchedFriends: 1, estimatedTotalMiles: 200,
      maxPerFriend: 200, overlappingRuleNames: [], initialStatus: 'available',
      expirationExampleAt: null,
    });
    const response = await call('/api/mileage/earning-rules/test', {
      method: 'POST',
      body: JSON.stringify({
        accountId: 'account-1',
        draft: { name: 'テスト', eventType: 'booking_completed', amount: 100, initialStatus: 'available' },
      }),
    });
    expect(response.status).toBe(200);
    expect(dbMocks.validateMileageEarningRuleDraft).toHaveBeenCalled();
    expect(dbMocks.testMileageEarningRuleDraft).toHaveBeenCalledWith(
      env.DB, expect.objectContaining({ lineAccountId: 'account-1' }),
    );
  });
});
