import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = {
  decryptCredential: vi.fn(),
  getMileageRewardDeliveryPlan: vi.fn(),
  getReservedMileageRewardCode: vi.fn(),
  recordMileageRedemptionAttempt: vi.fn(),
  refundMileageRewardRedemption: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const execute = vi.fn();
vi.mock('./automation-action-executors.js', () => ({
  createAutomationActionExecutors: () => ({ add_tag: execute }),
}));
vi.mock('./automation-engine.js', () => ({
  AutomationActionError: class AutomationActionError extends Error {},
}));

const { deliverMileageReward } = await import('./mileage-reward-delivery.js');

const db = {
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({ run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) })),
  })),
} as unknown as D1Database;

function plan(overrides: Record<string, unknown> = {}) {
  return {
    redemption: {
      id: 'redemption-1', status: 'reserved', attemptCount: 0,
      lineAccountId: 'account-1', rewardId: 'reward-1', rewardVersionId: 'version-1',
      beneficiaryFriendId: 'friend-1',
    },
    rewardName: '500円分の交換コード',
    rewardKind: 'coupon',
    customerMessage: '交換できました',
    failurePolicy: 'retry',
    actionConfig: null,
    commonActionVersionId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getMileageRewardDeliveryPlan.mockResolvedValue(plan());
  dbMocks.getReservedMileageRewardCode.mockResolvedValue({ id: 'code-1', ciphertext: 'encrypted' });
  dbMocks.decryptCredential.mockResolvedValue('REAL-CODE');
  dbMocks.recordMileageRedemptionAttempt.mockResolvedValue({ status: 'succeeded' });
  dbMocks.refundMileageRewardRedemption.mockResolvedValue({ status: 'refunded' });
});

describe('mileage reward delivery', () => {
  it('decrypts a reserved coupon only during authenticated delivery and records success', async () => {
    const result = await deliverMileageReward(db, 'redemption-1', {
      credentialEncryptionKey: 'secret',
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(result).toMatchObject({ status: 'succeeded', rewardCode: 'REAL-CODE' });
    expect(dbMocks.decryptCredential).toHaveBeenCalledWith('encrypted', 'secret');
    expect(dbMocks.recordMileageRedemptionAttempt).toHaveBeenCalledWith(db, {
      redemptionId: 'redemption-1', status: 'succeeded',
    });
  });

  it('schedules a retry without exposing the internal error', async () => {
    dbMocks.decryptCredential.mockRejectedValueOnce(new Error('kms transport failed'));
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(result).toMatchObject({
      status: 'delivery_failed',
      message: '特典を渡せませんでした。時間をおいてもう一度お試しください。',
      retryAt: '2026-08-29T00:01:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('kms');
    expect(dbMocks.refundMileageRewardRedemption).not.toHaveBeenCalled();
  });

  it('stops automatic retries after the shared three-retry limit', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      redemption: {
        ...plan().redemption,
        status: 'delivery_failed',
        attemptCount: 3,
      },
    }));
    dbMocks.decryptCredential.mockRejectedValueOnce(new Error('temporary provider failure'));

    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });

    expect(result).toMatchObject({ status: 'delivery_failed', retryAt: null });
    expect(dbMocks.recordMileageRedemptionAttempt).toHaveBeenCalledWith(db, expect.objectContaining({
      redemptionId: 'redemption-1', status: 'failed', retryAt: null,
    }));
  });

  it('restores mileage immediately when the published policy is refund', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({ failurePolicy: 'refund' }));
    dbMocks.decryptCredential.mockRejectedValueOnce(new Error('delivery failed'));
    const result = await deliverMileageReward(db, 'redemption-1');
    expect(dbMocks.refundMileageRewardRedemption).toHaveBeenCalledWith(db, {
      redemptionId: 'redemption-1',
      reason: '特典を渡せなかったためマイルを自動で戻す',
    });
    expect(result).toMatchObject({
      status: 'delivery_failed',
      retryAt: null,
      message: '特典を渡せなかったため、交換したマイルを戻しました。',
    });
  });

  it('executes a pinned common-action version instead of the mutable owner', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      commonActionVersionId: 'common-version-7',
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    const result = await deliverMileageReward(db, 'redemption-1');
    expect(result.status).toBe('succeeded');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      commonActionVersionId: 'common-version-7',
      friendId: 'friend-1',
      isTest: false,
    }));
  });
});
