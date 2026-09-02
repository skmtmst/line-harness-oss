import {
  claimWebhookInteractionRetry,
  createWebhookInteraction,
  finishWebhookInteraction,
  getOutgoingWebhookById,
  restoreWebhookInteractionFailure,
  type WebhookInteractionFailureReason,
  type WebhookInteractionRow,
} from '@line-crm/db';

import { deliverWebhook, recordDeliveryOutcome } from './outgoing-webhook-delivery.js';

export function webhookFailureLabel(reason: WebhookInteractionFailureReason | null): string | null {
  switch (reason) {
    case 'connection_failed': return 'つなぎ先から返事がありませんでした';
    case 'response_4xx': return 'つなぎ先が内容を受け取れませんでした';
    case 'response_429': return 'つなぎ先が混み合っていました';
    case 'response_5xx': return 'つなぎ先で処理できませんでした';
    case 'processing_failed': return '受け取った内容を処理できませんでした';
    case 'unknown': return '結果を確認できませんでした';
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

function failureReason(status: number | null): WebhookInteractionFailureReason {
  if (status === null) return 'connection_failed';
  if (status === 429) return 'response_429';
  if (status >= 500) return 'response_5xx';
  if (status >= 400) return 'response_4xx';
  return 'unknown';
}

/**
 * 失敗した送信を同じ冪等キーでやり直す。
 *
 * 相手が処理したあと返事だけ失われた場合でも、同じキーなら受け手が
 * 二重処理を防げる。URL・secret・送信本文はAPIへ返さない。
 */
export async function retryWebhookInteraction(
  db: D1Database,
  original: WebhookInteractionRow,
): Promise<WebhookInteractionRow> {
  if (original.direction !== 'outgoing' || original.status !== 'failed' || !original.webhook_id) {
    throw new Error('not_retryable');
  }
  const webhook = await getOutgoingWebhookById(db, original.webhook_id, original.line_account_id);
  if (!webhook) throw new Error('webhook_not_found');
  if (!webhook.is_active) throw new Error('webhook_inactive');
  if (!original.request_body_json) throw new Error('payload_unavailable');

  const claimed = await claimWebhookInteractionRetry(db, original.id, original.line_account_id);
  if (!claimed) throw new Error('already_retried');

  let retry: WebhookInteractionRow | null = null;
  const started = Date.now();
  try {
    retry = await createWebhookInteraction(db, {
      lineAccountId: original.line_account_id,
      direction: 'outgoing',
      webhookId: original.webhook_id,
      webhookName: original.webhook_name,
      eventType: original.event_type,
      triggerSummary: original.trigger_summary,
      requestBodyJson: original.request_body_json,
      idempotencyKey: original.idempotency_key,
      retryOfId: original.id,
    });
    const result = await deliverWebhook(webhook, original.request_body_json, {
      idempotencyKey: original.idempotency_key,
    });
    await finishWebhookInteraction(db, retry.id, original.line_account_id, {
      status: result.ok ? 'succeeded' : 'failed',
      responseStatus: result.lastStatus,
      attemptCount: result.attempts,
      durationMs: Date.now() - started,
      failureReason: result.ok ? null : failureReason(result.lastStatus),
    });
    await recordDeliveryOutcome(db, webhook.id, result.ok);
    return (await db.prepare(
      'SELECT * FROM webhook_interaction_logs WHERE id=? AND line_account_id=?',
    ).bind(retry.id, original.line_account_id).first<WebhookInteractionRow>())!;
  } catch (error) {
    if (retry) {
      await finishWebhookInteraction(db, retry.id, original.line_account_id, {
        status: 'failed',
        responseStatus: null,
        attemptCount: 1,
        durationMs: Date.now() - started,
        failureReason: 'unknown',
      });
      return (await db.prepare(
        'SELECT * FROM webhook_interaction_logs WHERE id=? AND line_account_id=?',
      ).bind(retry.id, original.line_account_id).first<WebhookInteractionRow>())!;
    }
    await restoreWebhookInteractionFailure(db, original.id, original.line_account_id);
    throw error;
  }
}
