import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = {
  decryptCredential: vi.fn(),
  getMileageRewardDeliveryPlan: vi.fn(),
  getReservedMileageRewardCode: vi.fn(),
  claimRedemptionStep: vi.fn().mockResolvedValue('send'),
  claimRedemptionStepForRecovery: vi.fn().mockResolvedValue('send'),
  markRedemptionStepSent: vi.fn().mockResolvedValue(undefined),
  clearRedemptionStepIntent: vi.fn().mockResolvedValue(undefined),
  hasSentRedemptionSteps: vi.fn().mockResolvedValue(false),
  MILEAGE_REWARD_RETRY_KEY_VALIDITY_MS: 24 * 60 * 60 * 1000,
  MileageRedemptionConfirmError: class MileageRedemptionConfirmError extends Error {},
  MileageRewardError: class MileageRewardError extends Error {
    code: string;
    constructor(code: string, message: string, status?: number) {
      super(message);
      this.code = code;
    }
  },
  recordMileageRedemptionAttempt: vi.fn(),
  refundMileageRewardRedemption: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const execute = vi.fn();
const executeWebhook = vi.fn();
vi.mock('../automations/automation-action-executors.js', () => ({
  createAutomationActionExecutors: () => ({ add_tag: execute, send_webhook: executeWebhook }),
}));
vi.mock('../automations/automation-engine.js', () => ({
  AutomationActionError: class AutomationActionError extends Error {
    code: string;
    retryable: boolean;
    constructor(code: string, message: string, retryable: boolean) {
      super(message);
      this.code = code;
      this.retryable = retryable;
    }
  },
}));

vi.mock('../../services/feature-enforcement.js', () => ({ featureJobCanRun: async () => true }));
const mileageSourceMocks = vi.hoisted(() => ({ resolveMileageSource: vi.fn().mockResolvedValue('musubo') }));
vi.mock('../../services/mileage-ec-source.js', () => mileageSourceMocks);

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
  it('EC管理の予約済み交換を配送せず状態も変えない', async () => {
    mileageSourceMocks.resolveMileageSource.mockResolvedValueOnce('ec');
    const result = await deliverMileageReward(db, 'redemption-1');
    expect(result.message).toContain('ECで管理');
    expect(db.prepare).not.toHaveBeenCalled();
    expect(dbMocks.recordMileageRedemptionAttempt).not.toHaveBeenCalled();
  });
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

  /*
   * 貸出を取れなければ外部へ送っていない。送信済みとは返さず交換を元の状態へ戻し、失敗一覧と再試行から取り残さない。
   */
  it('waits without sending and puts the redemption back when the step lease is held', async () => {
    const statements: Array<{ sql: string; binds: unknown[] }> = [];
    const recordingDb = {
      prepare: (sql: string) => ({
        bind: (...binds: unknown[]) => {
          statements.push({ sql, binds });
          return { run: async () => ({ meta: { changes: 1 } }) };
        },
      }),
    } as unknown as D1Database;

    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      redemption: {
        id: 'redemption-1', status: 'delivery_failed', attemptCount: 1,
        nextRetryAt: '2026-08-29T00:01:00.000Z',
        lineAccountId: 'account-1', rewardId: 'reward-1', rewardVersionId: 'version-1',
        beneficiaryFriendId: 'friend-1',
      },
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    dbMocks.claimRedemptionStep.mockResolvedValueOnce('busy');
    const result = await deliverMileageReward(recordingDb, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });

    expect(result).toMatchObject({ status: 'delivery_failed' });
    // 送っていないので「送信は終わっています」と言わない。
    expect(result.message ?? '').not.toContain('送信は終わっています');
    expect(result.message ?? '').toContain('もう一度');
    // やり直しの目安は元の行のものを残す(消さない)。
    expect(result.retryAt).toBe('2026-08-29T00:01:00.000Z');
    expect(execute).not.toHaveBeenCalled();
    expect(dbMocks.markRedemptionStepSent).not.toHaveBeenCalled();
    expect(dbMocks.recordMileageRedemptionAttempt).not.toHaveBeenCalledWith(
      recordingDb, expect.objectContaining({ status: 'failed' }),
    );
    // 押す前の状態へ戻す書き込みが出ている。
    // claim 側の SQL も `status = 'delivering'` を含むので、戻す側の
    // 「状態を差し替える」形(`SET status = ?`)で選ぶ。
    const restore = statements.find((statement) =>
      statement.sql.includes('UPDATE mileage_redemptions')
      && statement.sql.includes('SET status = ?'));
    expect(restore).toBeDefined();
    expect(restore?.binds[0]).toBe('delivery_failed');
    expect(restore?.binds[2]).toBe('redemption-1');
  });

  it('waits without sending or confirming an uncertain step', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    dbMocks.claimRedemptionStep.mockResolvedValueOnce('reconcile');
    // 回復も引き継げない行は、送らず勝手に確定もせず待つ。
    dbMocks.claimRedemptionStepForRecovery.mockResolvedValueOnce('reconcile');
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    // 送ったか確かめられない行は、送らず勝手に確定もせず待つ。
    expect(result).toMatchObject({ status: 'delivery_failed' });
    expect(result.message ?? '').toContain('確認しています');
    expect(execute).not.toHaveBeenCalled();
    expect(dbMocks.markRedemptionStepSent).not.toHaveBeenCalled();
    expect(dbMocks.recordMileageRedemptionAttempt).not.toHaveBeenCalledWith(db, expect.objectContaining({
      status: 'failed',
    }));
  });

  it('retries a transient confirmation and succeeds without resending', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    dbMocks.markRedemptionStepSent.mockRejectedValueOnce(
      new dbMocks.MileageRedemptionConfirmError('transient confirm failure'),
    );
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(result.status).toBe('succeeded');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dbMocks.markRedemptionStepSent).toHaveBeenCalledTimes(2);
  });

  it('waits when confirmations keep failing instead of resending', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    dbMocks.markRedemptionStepSent.mockRejectedValue(
      new dbMocks.MileageRedemptionConfirmError('confirm failed'),
    );
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(result).toMatchObject({ status: 'delivery_failed' });
    expect(result.message ?? '').toContain('確認しています');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordMileageRedemptionAttempt).not.toHaveBeenCalledWith(db, expect.objectContaining({
      status: 'failed',
    }));
  });

  it('waits without recording failure when the send is unconfirmed', async () => {
    const { AutomationActionError } = await import('../automations/automation-engine.js');
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    execute.mockRejectedValueOnce(new AutomationActionError('delivery_unconfirmed', 'unlogged', false));
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    // 外部送信は終わっている。証言は送る前に残してあるので触らない。
    expect(result).toMatchObject({ status: 'delivery_failed' });
    expect(result.message ?? '').toContain('確認しています');
    expect(dbMocks.clearRedemptionStepIntent).not.toHaveBeenCalled();
    expect(dbMocks.recordMileageRedemptionAttempt).not.toHaveBeenCalledWith(db, expect.objectContaining({
      status: 'failed',
    }));
  });

  it('clears the intent and records failure when the send itself fails', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    execute.mockRejectedValueOnce(new Error('webhook exploded before sending'));
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    // 送っていないことが決まったので、証言を消してやり直し可能に戻す。
    expect(dbMocks.clearRedemptionStepIntent).toHaveBeenCalledWith(db, expect.objectContaining({
      redemptionId: 'redemption-1', stepKey: '0:step-1',
    }));
    expect(dbMocks.recordMileageRedemptionAttempt).toHaveBeenCalledWith(db, expect.objectContaining({
      redemptionId: 'redemption-1', status: 'failed',
    }));
    expect(result).toMatchObject({ status: 'delivery_failed', retryAt: '2026-08-29T00:01:00.000Z' });
  });

  /*
   * 成功済みの手順を繰り返さないよう、部分配送済みの交換は全額返却せず、未完了だけを再試行する。
   */
  it('does not refund the full cost when an earlier step already succeeded', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      failurePolicy: 'refund',
      actionConfig: JSON.stringify([
        { id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' },
        { id: 'step-2', type: 'add_tag', params: { tagId: 'tag-2' }, onFailure: 'stop' },
      ]),
    }));
    // 1手順目は渡し済みで飛ばし、2手順目だけ実行して失敗する。
    dbMocks.claimRedemptionStep
      .mockResolvedValueOnce('sent')
      .mockResolvedValueOnce('send');
    execute.mockRejectedValueOnce(new Error('tag-2 is gone'));
    dbMocks.hasSentRedemptionSteps.mockResolvedValueOnce(true);
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dbMocks.refundMileageRewardRedemption).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'delivery_failed' });
    expect(result.message ?? '').toContain('渡し済み');
    // 未完了の手順だけやり直せるよう、再試行の目安を残す。
    expect(result.retryAt).toBe('2026-08-29T00:01:00.000Z');
  });

  /*
   * 再試行が先に成功していれば、遅れた返却処理で成功済みの交換を書き換えず、成功として返す。
   */
  it('returns success when a late refund finds the redemption already delivered', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({ failurePolicy: 'refund' }));
    dbMocks.decryptCredential.mockRejectedValueOnce(new Error('delivery failed'));
    dbMocks.refundMileageRewardRedemption.mockRejectedValueOnce(
      new dbMocks.MileageRewardError('already_delivered', 'すでに特典を渡した交換は返金できません', 409),
    );
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(result).toMatchObject({ status: 'succeeded' });
  });

  /*
   * 最初の送信から24時間を過ぎた手順は同じキーで再送せず、自動返却もしない。重複を避けるため照合待ちに残す。
   */
  it('holds without resending or refunding when the retry key is expired', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      failurePolicy: 'refund',
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    dbMocks.claimRedemptionStep.mockResolvedValueOnce('expired');
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(dbMocks.refundMileageRewardRedemption).not.toHaveBeenCalled();
    expect(dbMocks.recordMileageRedemptionAttempt).not.toHaveBeenCalledWith(db, expect.objectContaining({
      status: 'failed',
    }));
    expect(result).toMatchObject({ status: 'delivery_failed', retryAt: null });
    expect(result.message ?? '').toContain('24時間');
  });

  /*
   * 照合待ちは、再送しても安全な種類だけを期限内に回復する。回復できれば二重送信せず成功へ進む。
   */
  it('recovers a reconcilable step without resending the benefit twice', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      actionConfig: JSON.stringify([{
        id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop',
      }]),
    }));
    dbMocks.claimRedemptionStep.mockResolvedValueOnce('reconcile');
    dbMocks.claimRedemptionStepForRecovery.mockResolvedValueOnce('send');
    // 前の試験で確定を失敗させ続けているので、既定に戻す。
    dbMocks.markRedemptionStepSent.mockResolvedValue(undefined);
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'succeeded' });
  });

  /*
   * Webhookの照合待ちは、受け先で二重に処理されるため
   * 自動では回復しない。送らず照合待ちのまま残す。
   */
  it('does not auto-recover a webhook step left unconfirmed', async () => {
    dbMocks.getMileageRewardDeliveryPlan.mockResolvedValueOnce(plan({
      rewardKind: 'tag',
      actionConfig: JSON.stringify([{
        id: 'w1', type: 'send_webhook', params: { webhookId: 'webhook-1' }, onFailure: 'stop',
      }]),
    }));
    dbMocks.claimRedemptionStep.mockResolvedValueOnce('reconcile');
    const result = await deliverMileageReward(db, 'redemption-1', {
      now: () => '2026-08-29T00:00:00.000Z',
    });
    expect(executeWebhook).not.toHaveBeenCalled();
    expect(dbMocks.claimRedemptionStepForRecovery).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'delivery_failed' });
    expect(result.message ?? '').toContain('確認しています');
  });

  it('executes a pinned common-action version instead of the mutable owner', async () => {
    // 前の試験で確定を失敗させ続けているので、既定に戻す。
    dbMocks.markRedemptionStepSent.mockResolvedValue(undefined);
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
