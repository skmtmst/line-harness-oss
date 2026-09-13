import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  markMileageAdjustmentNotification: vi.fn(),
  reserveMileageAdjustmentNotification: vi.fn(),
  resolveLineCredential: vi.fn(),
}));
const dispatchLineProxyLocally = vi.hoisted(() => vi.fn());

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('./local-line-proxy.js', () => ({ dispatchLineProxyLocally }));

const {
  mileageAdjustmentMessage,
  sendMileageAdjustmentNotification,
} = await import('./mileage-adjustment-notification.js');

function context() {
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue({
          id: 'friend-1', line_user_id: 'U11111111111111111111111111111111', is_following: 1,
          channel_access_token: 'plain-token', channel_access_token_encrypted: null,
        }),
      })),
    })),
  } as unknown as D1Database;
  return {
    env: { DB: db, WORKER_PUBLIC_URL: 'https://worker.example.com' },
    req: { url: 'https://worker.example.com/api/mileage/adjustments' },
    executionCtx: {},
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.reserveMileageAdjustmentNotification.mockResolvedValue({
    id: 'notification-1', status: 'pending', attemptCount: 0,
  });
  dbMocks.resolveLineCredential.mockResolvedValue('resolved-token');
  dbMocks.markMileageAdjustmentNotification.mockImplementation(async (_db, input) => ({
    id: input.id, status: input.status, attemptCount: 1,
    lineRequestId: input.lineRequestId ?? null, errorCode: input.errorCode ?? null,
  }));
  dispatchLineProxyLocally.mockResolvedValue(new Response(null, {
    status: 200, headers: { 'x-line-request-id': 'line-request-1' },
  }));
});

describe('mileage adjustment notification', () => {
  it('sends an automatic notification through Harness Proxy with the UUID retry key', async () => {
    const idempotencyKey = '11111111-2222-4333-8444-555555555555';
    const result = await sendMileageAdjustmentNotification(context(), {
      lineAccountId: 'account-1', friendId: 'friend-1', ledgerEntryId: 'entry-1',
      idempotencyKey, message: 'マイルが増えました',
    });
    expect(result).toMatchObject({ status: 'sent', lineRequestId: 'line-request-1' });
    const request = dispatchLineProxyLocally.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://worker.example.com/line-api/v2/bot/message/push');
    expect(request.headers.get('X-Line-Retry-Key')).toBe(idempotencyKey);
    expect(request.headers.has('X-Line-Harness-Source')).toBe(false);
    expect(await request.json()).toEqual({
      to: 'U11111111111111111111111111111111',
      messages: [{ type: 'text', text: 'マイルが増えました' }],
    });
  });

  it('does not send a notification that was already recorded as sent', async () => {
    dbMocks.reserveMileageAdjustmentNotification.mockResolvedValueOnce({
      id: 'notification-1', status: 'sent', attemptCount: 1,
    });
    await expect(sendMileageAdjustmentNotification(context(), {
      lineAccountId: 'account-1', friendId: 'friend-1', ledgerEntryId: 'entry-1',
      idempotencyKey: '11111111-2222-4333-8444-555555555555', message: '本文',
    })).resolves.toMatchObject({ status: 'sent' });
    expect(dispatchLineProxyLocally).not.toHaveBeenCalled();
  });

  it('returns a compact Japanese message without exposing an internal identifier', () => {
    const message = mileageAdjustmentMessage({
      direction: 'increase', amount: 1_200, balanceAfter: 2_000,
      expiresAt: '2026-12-31T15:00:00.000Z',
    });
    expect(message).toContain('1,200 mile 増えました');
    expect(message).toContain('2,000 mile');
    expect(message).toContain('2027/01/01');
  });
});
