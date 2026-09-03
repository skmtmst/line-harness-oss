import {
  decryptCredential,
  getMileageRewardDeliveryPlan,
  getReservedMileageRewardCode,
  recordMileageRedemptionAttempt,
  refundMileageRewardRedemption,
  type MileageRewardFailurePolicy,
} from '@line-crm/db';
import { createAutomationActionExecutors } from './automation-action-executors.js';
import { AutomationActionError, type ActionDefinition } from './automation-engine.js';

export interface MileageRewardDeliveryOptions {
  credentialEncryptionKey?: string;
  fetch?: typeof fetch;
  now?: () => string;
}

export interface MileageRewardDeliveryResult {
  status: 'succeeded' | 'delivery_failed';
  rewardName: string;
  customerMessage: string;
  rewardCode: string | null;
  retryAt: string | null;
  failurePolicy: MileageRewardFailurePolicy;
  message: string | null;
}

function parseActions(raw: string | null): ActionDefinition[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('交換後の動きを読み込めませんでした'); }
  if (!Array.isArray(value)) throw new Error('交換後の動きを読み込めませんでした');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`${index + 1}番目の交換後アクションが不正です`);
    const action = item as Record<string, unknown>;
    if (typeof action.id !== 'string' || typeof action.type !== 'string'
      || !action.params || typeof action.params !== 'object' || Array.isArray(action.params)) {
      throw new Error(`${index + 1}番目の交換後アクションが不正です`);
    }
    if (action.type === 'wait' || action.type === 'common_action') {
      throw new Error('待ち時間を含む交換後アクションは実行できません');
    }
    return {
      id: action.id,
      type: action.type,
      params: action.params as Record<string, unknown>,
      onFailure: action.onFailure === 'continue' ? 'continue' : 'stop',
    };
  });
}

async function stableUuid(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function publicFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof AutomationActionError) {
    const permanent = new Set([
      'friend_required', 'friend_not_found', 'tag_not_found', 'scenario_not_found',
      'template_not_found', 'message_content_missing', 'rich_menu_not_found',
      'webhook_url_unsafe', 'idempotency_key_conflict',
    ]);
    return {
      code: error.code,
      message: permanent.has(error.code)
        ? '特典の設定を確認できないため、交換を完了できませんでした。運用者へお問い合わせください。'
        : '特典を渡せませんでした。時間をおいてもう一度お試しください。',
      retryable: error.retryable,
    };
  }
  return {
    code: 'reward_delivery_failed',
    message: '特典を渡せませんでした。時間をおいてもう一度お試しください。',
    retryable: true,
  };
}

function nextRetry(now: string, attemptCount: number): string | null {
  // 共通基盤 §6-2: 初回後は1分・5分・30分の3回まで。
  const delays = [1, 5, 30];
  if (attemptCount >= delays.length) return null;
  const date = new Date(now);
  date.setMinutes(date.getMinutes() + delays[attemptCount]);
  return date.toISOString();
}

export async function deliverMileageReward(
  db: D1Database,
  redemptionId: string,
  options: MileageRewardDeliveryOptions = {},
): Promise<MileageRewardDeliveryResult> {
  const plan = await getMileageRewardDeliveryPlan(db, redemptionId);
  if (plan.redemption.status === 'succeeded') {
    const code = await getReservedMileageRewardCode(db, redemptionId);
    return {
      status: 'succeeded',
      rewardName: plan.rewardName,
      customerMessage: plan.customerMessage,
      rewardCode: code
        ? await decryptCredential(code.ciphertext, options.credentialEncryptionKey)
        : null,
      retryAt: null,
      failurePolicy: plan.failurePolicy,
      message: null,
    };
  }
  if (plan.redemption.status === 'refunded') {
    return {
      status: 'delivery_failed', rewardName: plan.rewardName,
      customerMessage: plan.customerMessage, rewardCode: null, retryAt: null,
      failurePolicy: plan.failurePolicy, message: '交換したマイルは戻されています。',
    };
  }

  const now = options.now?.() ?? new Date().toISOString();
  const claim = await db.prepare(
    `UPDATE mileage_redemptions SET status = 'delivering', updated_at = ?
      WHERE id = ? AND status IN ('reserved', 'delivery_failed')`,
  ).bind(now, redemptionId).run();
  if ((claim.meta?.changes ?? 0) !== 1) {
    return {
      status: 'delivery_failed', rewardName: plan.rewardName,
      customerMessage: plan.customerMessage, rewardCode: null,
      retryAt: plan.redemption.nextRetryAt,
      failurePolicy: plan.failurePolicy,
      message: '交換処理を確認しています。少し待ってから読み直してください。',
    };
  }
  try {
    let rewardCode: string | null = null;
    if (plan.rewardKind === 'coupon') {
      const code = await getReservedMileageRewardCode(db, redemptionId);
      if (!code) throw new Error('交換コードを確保できませんでした');
      rewardCode = await decryptCredential(code.ciphertext, options.credentialEncryptionKey);
    } else {
      const actions = parseActions(plan.actionConfig);
      if (!actions.length) throw new Error('交換後の動きがありません');
      const executors = createAutomationActionExecutors({
        credentialEncryptionKey: options.credentialEncryptionKey,
        fetch: options.fetch,
        now: options.now,
      });
      for (const [index, action] of actions.entries()) {
        const executor = executors[action.type];
        if (!executor) throw new Error('交換後の動きを実行できません');
        const stepExecutionId = await stableUuid(`${redemptionId}:${action.id}:${index}`);
        await executor({
          db,
          runId: redemptionId,
          lineAccountId: plan.redemption.lineAccountId,
          automationId: `mileage-reward:${plan.redemption.rewardId}`,
          automationVersionId: plan.redemption.rewardVersionId,
          friendId: plan.redemption.beneficiaryFriendId,
          sourceEventId: redemptionId,
          inputEvent: { kind: 'mileage_reward_redeemed', rewardId: plan.redemption.rewardId },
          action,
          stepExecutionId,
          idempotencyKey: stepExecutionId,
          attemptNumber: plan.redemption.attemptCount + 1,
          commonActionVersionId: plan.commonActionVersionId,
          isTest: false,
        });
      }
    }
    await recordMileageRedemptionAttempt(db, { redemptionId, status: 'succeeded' });
    return {
      status: 'succeeded', rewardName: plan.rewardName,
      customerMessage: plan.customerMessage, rewardCode, retryAt: null,
      failurePolicy: plan.failurePolicy, message: null,
    };
  } catch (error) {
    const failure = publicFailure(error);
    const retryAt = failure.retryable && plan.failurePolicy === 'retry'
      ? nextRetry(now, plan.redemption.attemptCount)
      : null;
    await recordMileageRedemptionAttempt(db, {
      redemptionId,
      status: 'failed',
      errorCode: failure.code,
      errorMessage: failure.message,
      retryAt,
    });
    if (plan.failurePolicy === 'refund') {
      await refundMileageRewardRedemption(db, {
        redemptionId,
        reason: '特典を渡せなかったためマイルを自動で戻す',
      });
    }
    return {
      status: 'delivery_failed', rewardName: plan.rewardName,
      customerMessage: plan.customerMessage, rewardCode: null, retryAt,
      failurePolicy: plan.failurePolicy,
      message: plan.failurePolicy === 'refund'
        ? '特典を渡せなかったため、交換したマイルを戻しました。'
        : failure.message,
    };
  }
}

/** Cronから、再試行時刻を過ぎた交換だけを処理する。claimはdeliver側で行う。 */
export async function processDueMileageRewardDeliveries(
  db: D1Database,
  options: Omit<MileageRewardDeliveryOptions, 'now'> & { now: string; limit?: number },
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const due = await db.prepare(
    `SELECT id FROM mileage_redemptions
      WHERE status = 'delivery_failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?
      ORDER BY next_retry_at, created_at LIMIT ?`,
  ).bind(options.now, limit).all<{ id: string }>();
  let succeeded = 0;
  let failed = 0;
  for (const item of due.results) {
    const result = await deliverMileageReward(db, item.id, {
      credentialEncryptionKey: options.credentialEncryptionKey,
      fetch: options.fetch,
      now: () => options.now,
    });
    if (result.status === 'succeeded') succeeded += 1;
    else failed += 1;
  }
  return { processed: due.results.length, succeeded, failed };
}
