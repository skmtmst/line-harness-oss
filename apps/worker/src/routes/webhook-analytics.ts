import { logger } from '@line-crm/shared/server';
import type { WebhookEvent } from '@line-crm/line-sdk';
import { recordAnalyticsEvent } from '@line-crm/db';

export function logWebhookStepFailure(
  stage: string,
  error: unknown,
  lineAccountId: string | null,
  event?: WebhookEvent,
): void {
  logger.error("line_webhook_step_failed");
}

export async function recordWebhookAnalyticsEvent(
  db: D1Database,
  lineAccountId: string | null,
  event: WebhookEvent,
  input: {
    friendId?: string | null;
    eventType: string;
    dimensions?: Record<string, unknown>;
  },
): Promise<void> {
  if (!lineAccountId) return;
  try {
    await recordAnalyticsEvent(db, {
      lineAccountId,
      friendId: input.friendId,
      eventType: input.eventType,
      sourceKind: 'line_webhook',
      sourceId: event.webhookEventId,
      occurredAt: new Date(event.timestamp).toISOString(),
      dimensions: input.dimensions,
    });
  } catch (error) {
    logWebhookStepFailure('analytics_event_record', error, lineAccountId, event);
  }
}
