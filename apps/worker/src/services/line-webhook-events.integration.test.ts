import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WebhookEvent } from '@line-crm/line-sdk';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processLineWebhookEvents } from './line-webhook-events.js';

function event(id: string): WebhookEvent {
  return {
    type: 'unfollow',
    timestamp: 0,
    source: { type: 'user', userId: `U-private-${id}` },
    webhookEventId: id,
    deliveryContext: { isRedelivery: false },
    mode: 'active',
  };
}

describe('LINE Webhook台帳と処理の統合', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
  });

  test('同じイベントIDは台帳1行・処理1回になる', async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    await processLineWebhookEvents({
      db: testDb.db,
      events: [event('evt-duplicate'), event('evt-duplicate')],
      lineAccountId: null,
      handle,
    });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(testDb.raw.prepare(
      `SELECT webhook_event_id, status, attempts, last_error
         FROM line_webhook_events`,
    ).all()).toEqual([{
      webhook_event_id: 'evt-duplicate',
      status: 'succeeded',
      attempts: 0,
      last_error: null,
    }]);
  });

  test('失敗を短く記録し、後続イベントを成功まで進める', async () => {
    const handle = vi.fn()
      .mockRejectedValueOnce(new Error('raw exception with private content'))
      .mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await processLineWebhookEvents({
      db: testDb.db,
      events: [event('evt-failed'), event('evt-succeeded')],
      lineAccountId: null,
      handle,
    });

    expect(testDb.raw.prepare(
      `SELECT webhook_event_id, status, attempts, last_error
         FROM line_webhook_events ORDER BY webhook_event_id`,
    ).all()).toEqual([
      { webhook_event_id: 'evt-failed', status: 'failed', attempts: 1, last_error: 'unknown' },
      { webhook_event_id: 'evt-succeeded', status: 'succeeded', attempts: 0, last_error: null },
    ]);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('raw exception with private content');
    errorSpy.mockRestore();
  });
});
