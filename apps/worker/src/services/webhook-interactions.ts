import {
  claimWebhookInteractionRetryAndInsert,
  deletePendingWebhookInteraction,
  finishWebhookInteraction,
  getOutgoingWebhookById,
  getWebhookInteractionById,
  isOperationCapabilityStopped,
  markFailedInteractionsRetried,
  resolveWebhookSecret,
  restoreWebhookInteractionFailure,
  type WebhookInteractionFailureReason,
  type WebhookInteractionRow,
  type WebhookKeyInput,
} from '@line-crm/db';

import {
  claimOutgoingDelivery,
  deliverWebhook,
  failureReasonForDelivery,
  findOutgoingDeliveryByKey,
  finishOutgoingDelivery,
  outgoingAttemptOf,
  recordDeliveryOutcome,
  releaseOutgoingDelivery,
  type OutgoingDeliveryRow,
} from './outgoing-webhook-delivery.js';

export function webhookFailureLabel(reason: WebhookInteractionFailureReason | null): string | null {
  switch (reason) {
    case 'connection_failed': return 'つなぎ先から返事がありませんでした';
    case 'response_4xx': return 'つなぎ先が内容を受け取れませんでした';
    case 'response_429': return 'つなぎ先が混み合っていました';
    case 'response_5xx': return 'つなぎ先で処理できませんでした';
    case 'processing_failed': return '受け取った内容を処理できませんでした';
    case 'unknown': return '結果を確認できませんでした';
    // d23b R415: こちら側の署名の準備ができず、相手へ一度も送れていない。
    // 「相手から返事がない」と混ぜない。設定を直してからやり直せる。
    case 'secret_unavailable': return '署名の合言葉を確認できないため、まだ送っていません';
    case null: return null;
  }
}

export function webhookResponseLabel(row: WebhookInteractionRow): string {
  if (row.status === 'failed') return webhookFailureLabel(row.failure_reason) ?? '処理できませんでした';
  if (row.status === 'pending') return '処理中です';
  if (row.direction === 'incoming') return '結びつきました';
  if (row.response_status != null) return `${row.response_status} OK`;
  return '届きました';
}

/**
 * 失敗した送信を同じ冪等キーでやり直す。
 *
 * 相手が処理したあと返事だけ失われた場合でも、同じキーなら受け手が
 * 二重処理を防げる。URL・secret・送信本文はAPIへ返さない。
 *
 * 同じ通知の自動配送台帳(outgoing_webhook_deliveries)との兼ね合い
 * (d23b R412):
 *   - 台帳に「届いた」印がある … 手動のやり直しは重ねない(already_delivered)
 *   - 自動の送り直しが動いている … lease を取ってこの要求で続きを送る。
 *     取れないときは自動側が動いている(auto_retry_scheduled)ので断る
 *   - 台帳が「失敗」で閉じている … 自動は尽きた。手動が後を引き継ぐ
 */
export async function retryWebhookInteraction(
  db: D1Database,
  original: WebhookInteractionRow,
  keys?: WebhookKeyInput | string,
): Promise<WebhookInteractionRow> {
  if (original.direction !== 'outgoing' || original.status !== 'failed' || !original.webhook_id) {
    throw new Error('not_retryable');
  }
  const webhookId = original.webhook_id;
  const webhook = await getOutgoingWebhookById(db, webhookId, original.line_account_id);
  if (!webhook) throw new Error('webhook_not_found');
  if (!webhook.is_active) throw new Error('webhook_inactive');
  if (!original.request_body_json) throw new Error('payload_unavailable');

  const delivery = await findOutgoingDeliveryByKey(db, webhookId, original.idempotency_key);
  let deliveryLease: string | null = null;
  if (delivery) {
    if (delivery.status === 'delivered') throw new Error('already_delivered');
    if (delivery.status !== 'failed') {
      deliveryLease = await claimOutgoingDelivery(db, delivery);
      if (!deliveryLease) throw new Error('auto_retry_scheduled');
    }
  }
  const releaseDelivery = async (row: OutgoingDeliveryRow | null, lease: string | null) => {
    if (row && lease) {
      await releaseOutgoingDelivery(db, row, lease).catch(() => {});
    }
  };

  try {
    // 緊急停止 (#1050): webhook_outgoing 停止中は手動再送も受け付けない。
    if (await isOperationCapabilityStopped(db, original.line_account_id, 'webhook_outgoing')) {
      throw new Error('emergency_stopped');
    }
    // 署名は送信直前に復号した値で付ける。secretが設定済みで読めない
    // (鍵不足・復号失敗)ときだけ送らずに止める(#650)。未設定の旧行は従来どおり送る。
    if (webhook.secret_encrypted || webhook.secret) {
      let sendSecret: string | null = null;
      try {
        sendSecret = await resolveWebhookSecret(webhook, keys);
      } catch {
        sendSecret = null;
      }
      if (!sendSecret) throw new Error('webhook_secret_unavailable');
    }
  } catch (error) {
    await releaseDelivery(delivery, deliveryLease);
    throw error;
  }

  // d23b R409: 元の記録を「やり直し済み」に畳むのと、やり直し用の記録を
  // 作るのを1つのDBバッチで行う。途中で止まっても「元は畳まれたが再送
  // 記録が無い」形は残らない。
  const { claimed, retryId } = await claimWebhookInteractionRetryAndInsert(db, original, {
    webhookId,
    webhookName: original.webhook_name,
    eventType: original.event_type,
    triggerSummary: original.trigger_summary,
    requestBodyJson: original.request_body_json,
    idempotencyKey: original.idempotency_key,
  });
  if (!claimed) {
    await releaseDelivery(delivery, deliveryLease);
    throw new Error('already_retried');
  }

  // d23b R413: 畳み込み〜送信のあいだに止まった・消えた分を、送る前に
  // もう一度確かめる。まだ送っていないので、この段階の中止は元の状態へ
  // そのまま戻せる。
  let sendTarget = webhook;
  try {
    if (await isOperationCapabilityStopped(db, original.line_account_id, 'webhook_outgoing')) {
      throw new Error('emergency_stopped');
    }
    const fresh = await getOutgoingWebhookById(db, webhookId, original.line_account_id);
    if (!fresh) throw new Error('webhook_not_found');
    if (!fresh.is_active) throw new Error('webhook_inactive');
    sendTarget = fresh;
  } catch (error) {
    await deletePendingWebhookInteraction(db, retryId, original.line_account_id).catch(() => {});
    await restoreWebhookInteractionFailure(db, original.id, original.line_account_id).catch(() => {});
    await releaseDelivery(delivery, deliveryLease);
    throw error;
  }

  const started = Date.now();
  try {
    // 署名用の復号は deliverWebhook が行う。ここでの復号は、送り直しを
    // 始める前に止めるための事前確認(#650 再審査)。
    const result = await deliverWebhook(sendTarget, original.request_body_json, {
      idempotencyKey: original.idempotency_key,
      credentialKeys: keys,
    });
    await finishWebhookInteraction(db, retryId, original.line_account_id, {
      status: result.ok ? 'succeeded' : 'failed',
      responseStatus: result.lastStatus,
      attemptCount: result.attempts,
      durationMs: Date.now() - started,
      failureReason: result.ok ? null : failureReasonForDelivery(result),
    });
    // R412: 手動で取り掛かった自動配送は、この結果で台帳も確定する。
    // 失敗なら retry_wait へ戻り、残りの自動の送り直しが続く。
    if (delivery && deliveryLease) {
      await finishOutgoingDelivery(db, delivery, deliveryLease, outgoingAttemptOf(result));
      deliveryLease = null;
    }
    await recordDeliveryOutcome(db, webhookId, result.ok);
    // R412: 届いた通知と同じ失敗記録は「やり直し済み」に畳む。
    if (result.ok) {
      await markFailedInteractionsRetried(
        db, original.line_account_id, webhookId, original.idempotency_key,
      );
    }
    return (await getWebhookInteractionById(db, retryId, original.line_account_id))!;
  } catch (error) {
    /*
      d23b R409: 結果の確定を書けなかったとき、無条件には元へ戻さない。
      再送記録が残っていれば（外部への送信が行われたかもしれないので）
      「届いたか分からない」失敗として閉じる試みだけをして返す。
      それも駄目なら pending のまま残し、一覧の滞留回収に任せる。
    */
    const existing = await getWebhookInteractionById(db, retryId, original.line_account_id)
      .catch(() => null);
    if (existing) {
      if (existing.status === 'pending') {
        await finishWebhookInteraction(db, retryId, original.line_account_id, {
          status: 'failed',
          responseStatus: null,
          attemptCount: 1,
          durationMs: Date.now() - started,
          failureReason: 'unknown',
        }).catch(() => {});
      }
      const settled = await getWebhookInteractionById(db, retryId, original.line_account_id)
        .catch(() => null);
      if (settled) return settled;
      return existing;
    }
    // 再送記録すら残っていない（バッチは原子的なので元の記録も失敗のまま）。
    await releaseDelivery(delivery, deliveryLease);
    await restoreWebhookInteractionFailure(db, original.id, original.line_account_id).catch(() => {});
    throw error;
  }
}
