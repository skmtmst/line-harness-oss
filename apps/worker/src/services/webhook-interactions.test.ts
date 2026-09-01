import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@line-crm/db', () => ({
  claimWebhookInteractionRetry: vi.fn(),
  createWebhookInteraction: vi.fn(),
  finishWebhookInteraction: vi.fn(),
  getOutgoingWebhookById: vi.fn(),
  restoreWebhookInteractionFailure: vi.fn(),
}));

vi.mock('./outgoing-webhook-delivery.js', () => ({
  deliverWebhook: vi.fn(),
  recordDeliveryOutcome: vi.fn(),
}));

import {
  claimWebhookInteractionRetry,
  createWebhookInteraction,
  finishWebhookInteraction,
  getOutgoingWebhookById,
  restoreWebhookInteractionFailure,
  type WebhookInteractionRow,
} from '@line-crm/db';
import { deliverWebhook, recordDeliveryOutcome } from './outgoing-webhook-delivery.js';
import { retryWebhookInteraction, webhookFailureLabel, webhookResponseLabel } from './webhook-interactions.js';

const original: WebhookInteractionRow = {
  id: 'run-1', line_account_id: 'account-a', direction: 'outgoing',
  webhook_id: 'wh-1', webhook_name: '顧客管理', event_type: 'friend.added',
  trigger_summary: '友だちが追加されたとき', status: 'failed',
  request_body_json: '{"event":"friend.added"}', response_status: 500,
  attempt_count: 1, duration_ms: 100, failure_reason: 'response_5xx',
  idempotency_key: 'delivery-1', retry_of_id: null,
  started_at: '2026-08-29T10:00:00.000+09:00',
  completed_at: '2026-08-29T10:00:00.100+09:00',
  created_at: '2026-08-29T10:00:00.000+09:00',
};

const retryRow: WebhookInteractionRow = {
  ...original, id: 'run-2', status: 'pending', response_status: null,
  failure_reason: null, retry_of_id: 'run-1', completed_at: null,
};

describe('Webhookの安全な送り直し', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOutgoingWebhookById).mockResolvedValue({
      id: 'wh-1', name: '顧客管理', url: 'https://example.com/hook', event_types: '["*"]',
      secret: 'a'.repeat(32), is_active: 1, max_retries: 0,
      consecutive_failures: 0, last_failed_at: null, line_account_id: 'account-a',
      created_at: '2026-08-29', updated_at: '2026-08-29',
    });
    vi.mocked(claimWebhookInteractionRetry).mockResolvedValue(true);
    vi.mocked(createWebhookInteraction).mockResolvedValue(retryRow);
    vi.mocked(finishWebhookInteraction).mockResolvedValue(undefined);
    vi.mocked(recordDeliveryOutcome).mockResolvedValue(undefined);
  });

  it('初回と同じ配送IDを使い、成功を新しい記録へ残す', async () => {
    vi.mocked(deliverWebhook).mockResolvedValue({ ok: true, attempts: 1, lastStatus: 200 });
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue({ ...retryRow, status: 'succeeded', response_status: 200 }) })),
      })),
    } as unknown as D1Database;

    const result = await retryWebhookInteraction(db, original);

    expect(createWebhookInteraction).toHaveBeenCalledWith(db, expect.objectContaining({
      retryOfId: 'run-1', idempotencyKey: 'delivery-1', requestBodyJson: original.request_body_json,
    }));
    expect(deliverWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wh-1' }),
      original.request_body_json,
      { idempotencyKey: 'delivery-1' },
    );
    expect(finishWebhookInteraction).toHaveBeenCalledWith(db, 'run-2', 'account-a', expect.objectContaining({
      status: 'succeeded', responseStatus: 200,
    }));
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(db, 'wh-1', true);
    expect(result.status).toBe('succeeded');
  });

  it('別アカウントのWebhook IDを使っても見つからなければ送らない', async () => {
    vi.mocked(getOutgoingWebhookById).mockResolvedValue(null);
    await expect(retryWebhookInteraction({} as D1Database, original)).rejects.toThrow('webhook_not_found');
    expect(deliverWebhook).not.toHaveBeenCalled();
    expect(claimWebhookInteractionRetry).not.toHaveBeenCalled();
  });

  it('同じ失敗を二重に確保できなければ送らない', async () => {
    vi.mocked(claimWebhookInteractionRetry).mockResolvedValue(false);
    await expect(retryWebhookInteraction({} as D1Database, original)).rejects.toThrow('already_retried');
    expect(deliverWebhook).not.toHaveBeenCalled();
  });

  it('新しい記録を作れなかった場合だけ元の失敗を再試行可能へ戻す', async () => {
    vi.mocked(createWebhookInteraction).mockRejectedValue(new Error('database unavailable'));
    await expect(retryWebhookInteraction({} as D1Database, original)).rejects.toThrow('database unavailable');
    expect(restoreWebhookInteractionFailure).toHaveBeenCalledWith(expect.anything(), 'run-1', 'account-a');
  });
});

describe('画面へ出す安全な言葉', () => {
  it('内部の失敗コードを日本語へ置き換える', () => {
    expect(webhookFailureLabel('response_429')).toBe('つなぎ先が混み合っていました');
    expect(webhookFailureLabel('processing_failed')).toBe('受け取った内容を処理できませんでした');
    expect(webhookResponseLabel(original)).toBe('つなぎ先で処理できませんでした');
  });
});
