import {
  claimRedemptionStep,
  clearRedemptionStepIntent,
  decryptCredential,
  getMileageRewardDeliveryPlan,
  getReservedMileageRewardCode,
  markRedemptionStepSent,
  MileageRedemptionConfirmError,
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

/**
 * 取り残し配送の貸出期限。確定書き込みに失敗した交換は `delivering` のまま
 * 残し、この期限を過ぎたら別の試行が引き継ぐ。証言つきの手順は
 * 引き継いでも送り直さず、照合待ちに残す。
 */
const STALE_DELIVERY_LEASE_MS = 5 * 60 * 1000;

/** 一瞬の書き込み失敗は、その場で数回だけやり直す。長引く障害は待つ。 */
const CONFIRM_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 証言つき確定を数回試す。通らなければ照合待ちとして投げる。
 * DB障害の生エラーはここで確定失敗に包む。包まないと「失敗」扱いになり、
 * やり直しで送り直して二重に届く。
 */
async function confirmStepSentWithRetry(
  db: D1Database,
  input: { redemptionId: string; stepKey: string; owner: string; fenceToken: string; now: string },
): Promise<void> {
  for (let attempt = 0; attempt < CONFIRM_RETRIES; attempt += 1) {
    try {
      await markRedemptionStepSent(db, input);
      return;
    } catch {
      if (attempt + 1 < CONFIRM_RETRIES) await sleep(50 * (attempt + 1));
    }
  }
  throw new MileageRedemptionConfirmError();
}

/** 証言消しを数回試す。消せなければ照合待ちとして投げる(同上)。 */
async function clearStepIntentWithRetry(
  db: D1Database,
  input: { redemptionId: string; stepKey: string; owner: string; fenceToken: string; now: string },
): Promise<void> {
  for (let attempt = 0; attempt < CONFIRM_RETRIES; attempt += 1) {
    try {
      await clearRedemptionStepIntent(db, input);
      return;
    } catch {
      if (attempt + 1 < CONFIRM_RETRIES) await sleep(50 * (attempt + 1));
    }
  }
  throw new MileageRedemptionConfirmError();
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
  const leaseCutoff = new Date(new Date(now).getTime() - STALE_DELIVERY_LEASE_MS).toISOString();
  // この走者の名札。手順の貸出はこの名札で取り、確定も名札と fence で通す。
  const stepOwner = crypto.randomUUID();
  const stepLeaseExpiresAt = new Date(new Date(now).getTime() + STALE_DELIVERY_LEASE_MS).toISOString();
  const claim = await db.prepare(
    `UPDATE mileage_redemptions SET status = 'delivering', updated_at = ?
      WHERE id = ? AND (status IN ('reserved', 'delivery_failed')
        OR (status = 'delivering' AND updated_at < ?))`,
  ).bind(now, redemptionId, leaseCutoff).run();
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
        const stepKey = `${index}:${action.id}`;
        const stepFence = crypto.randomUUID();
        const stepLease = {
          redemptionId, stepKey, idempotencyKey: stepExecutionId,
          owner: stepOwner, fenceToken: stepFence,
          leaseExpiresAt: stepLeaseExpiresAt, now,
        };
        /*
         * 送り直さない：送信済みの手順は飛ばす。貸出中の手順は待つ。
         * 証言つき(照合待ち)の手順は、送らず勝手に確定もせず待つ。
         * 受け手側にも同じ冪等キーを渡す。
         */
        const step = await claimRedemptionStep(db, stepLease);
        if (step === 'sent') continue;
        if (step === 'busy' || step === 'reconcile') {
          // 別の走者が送信中か、送ったか確かめられない行。
          // 送らずに待ち、貸出期限の回収も送り直さない。
          throw new MileageRedemptionConfirmError();
        }
        const stepConfirmation = {
          redemptionId, stepKey, owner: stepOwner, fenceToken: stepFence, now,
        };
        try {
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
        } catch (error) {
          if (error instanceof AutomationActionError && error.code === 'delivery_unconfirmed') {
            // 外部送信は終わっている。証言は送る前に残してあるので、
            // そのまま照合待ちに残し、送り直さない。
            throw new MileageRedemptionConfirmError();
          }
          /*
           * 送る前の失敗：証言を消して、やり直し可能に戻す。
           * 消せなければ送ったか分からないので、照合待ちに残す。
           */
          try {
            await clearStepIntentWithRetry(db, stepConfirmation);
          } catch {
            throw new MileageRedemptionConfirmError();
          }
          throw error;
        }
        // 証言つき確定を数回試す。通らなければ照合待ちに残す。
        await confirmStepSentWithRetry(db, stepConfirmation);
      }
    }
    try {
      await recordMileageRedemptionAttempt(db, { redemptionId, status: 'succeeded' });
    } catch {
      throw new MileageRedemptionConfirmError();
    }
    return {
      status: 'succeeded', rewardName: plan.rewardName,
      customerMessage: plan.customerMessage, rewardCode, retryAt: null,
      failurePolicy: plan.failurePolicy, message: null,
    };
  } catch (error) {
    if (error instanceof MileageRedemptionConfirmError) {
      /*
       * 外部送信は終わっているかもしれない。失敗に落とすとやり直しで
       * 再送するので、`delivering` のまま残して回収(cron・貸出期限)に任せる。
       * 呼び出し側には202相当の「確認中」で返す。
       */
      return {
        status: 'delivery_failed', rewardName: plan.rewardName,
        customerMessage: plan.customerMessage, rewardCode: null,
        retryAt: nextRetry(now, plan.redemption.attemptCount),
        failurePolicy: plan.failurePolicy,
        message: '特典の送信は終わっています。確定を確認しています。',
      };
    }
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

/**
 * Cronから、再試行時刻を過ぎた交換と、確定されず残った交換を処理する。
 * 後者は貸出期限切れの `delivering` で、引き継いだ試行が outbox を見る。
 * 証言つきの手順は送り直さず、照合待ちに残す。claimはdeliver側で行う。
 */
export async function processDueMileageRewardDeliveries(
  db: D1Database,
  options: Omit<MileageRewardDeliveryOptions, 'now'> & { now: string; limit?: number },
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const leaseCutoff = new Date(
    new Date(options.now).getTime() - STALE_DELIVERY_LEASE_MS,
  ).toISOString();
  const due = await db.prepare(
    `SELECT id FROM mileage_redemptions
      WHERE status = 'delivery_failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?
      ORDER BY next_retry_at, created_at LIMIT ?`,
  ).bind(options.now, limit).all<{ id: string }>();
  const remaining = Math.max(0, limit - due.results.length);
  const stalled = remaining > 0
    ? await db.prepare(
      `SELECT id FROM mileage_redemptions
        WHERE status = 'delivering' AND updated_at < ?
        ORDER BY updated_at, created_at LIMIT ?`,
    ).bind(leaseCutoff, remaining).all<{ id: string }>()
    : { results: [] as { id: string }[] };
  let succeeded = 0;
  let failed = 0;
  for (const item of [...due.results, ...stalled.results]) {
    const result = await deliverMileageReward(db, item.id, {
      credentialEncryptionKey: options.credentialEncryptionKey,
      fetch: options.fetch,
      now: () => options.now,
    });
    if (result.status === 'succeeded') succeeded += 1;
    else failed += 1;
  }
  return { processed: due.results.length + stalled.results.length, succeeded, failed };
}
