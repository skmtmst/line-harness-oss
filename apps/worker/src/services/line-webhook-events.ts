import type { WebhookEvent } from '@line-crm/line-sdk';
import {
  markLineWebhookEventFailed,
  markLineWebhookEventSucceeded,
  reserveLineWebhookEvent,
} from '@line-crm/db';
import type { LineWebhookErrorClassification } from '@line-crm/db';

type SafeWebhookLog = {
  event: string;
  webhook_event_id: string;
  line_account_id: string | null;
  event_type: string;
  reason?: LineWebhookErrorClassification;
};

export type WebhookEventHandler = (event: WebhookEvent) => Promise<void>;

/**
 * 例外の本文は保存もログ出力もせず、運用に必要な短い分類だけへ変換する。
 */
export function classifyLineWebhookError(error: unknown): LineWebhookErrorClassification {
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  } | null;
  const name = typeof candidate?.name === 'string' ? candidate.name.toLowerCase() : '';
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';
  const status = candidate?.status ?? candidate?.statusCode;

  if (
    name.includes('d1') ||
    name.includes('sqlite') ||
    message.includes('d1_error') ||
    message.includes('sqlite')
  ) {
    return 'db_error';
  }
  if (
    name.includes('line') ||
    message.includes('line api error') ||
    (typeof status === 'number' && status >= 400 && status <= 599)
  ) {
    return 'line_api_error';
  }
  return 'unknown';
}

function safeLog(
  level: 'log' | 'warn' | 'error',
  value: SafeWebhookLog,
): void {
  console[level](value);
}

/**
 * 1リクエスト内のイベントを、それぞれ独立して処理する。
 * 1件の失敗をここで吸収するため、後続イベントとLINEへの200応答を止めない。
 */
export async function processLineWebhookEvents(input: {
  db: D1Database;
  events: WebhookEvent[];
  lineAccountId: string | null;
  handle: WebhookEventHandler;
}): Promise<void> {
  for (const webhookEvent of input.events) {
    const logBase: SafeWebhookLog = {
      event: 'line_webhook_event',
      webhook_event_id: webhookEvent.webhookEventId,
      line_account_id: input.lineAccountId,
      event_type: webhookEvent.type,
    };

    const reservation = {
      webhookEventId: webhookEvent.webhookEventId,
      lineAccountId: input.lineAccountId,
      eventType: webhookEvent.type,
    };
    let acquired: boolean | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        acquired = await reserveLineWebhookEvent(input.db, reservation);
        break;
      } catch {
        safeLog('error', { ...logBase, event: 'line_webhook_ledger_reserve_failed', reason: 'db_error' });
      }
    }

    if (!acquired) {
      if (acquired === null) {
        // 台帳が使えず重複防止が効かないが、イベントを失わないため本処理を優先する。
        safeLog('warn', {
          ...logBase,
          event: 'line_webhook_ledger_unavailable_processed',
          reason: 'db_error',
        });
      } else {
        safeLog('log', { ...logBase, event: 'line_webhook_duplicate_skipped' });
        continue;
      }
    }

    try {
      await input.handle(webhookEvent);
      if (acquired === null) continue;
      await markLineWebhookEventSucceeded(input.db, webhookEvent.webhookEventId);
    } catch (error) {
      const reason = classifyLineWebhookError(error);
      if (acquired === null) {
        safeLog('error', { ...logBase, event: 'line_webhook_event_failed', reason });
        continue;
      }
      try {
        await markLineWebhookEventFailed(input.db, webhookEvent.webhookEventId, reason);
      } catch {
        safeLog('error', { ...logBase, event: 'line_webhook_ledger_update_failed', reason: 'db_error' });
        continue;
      }
      safeLog('error', { ...logBase, event: 'line_webhook_event_failed', reason });
    }
  }
}
