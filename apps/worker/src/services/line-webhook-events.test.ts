import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WebhookEvent } from '@line-crm/line-sdk';

const dbMocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  succeeded: vi.fn(),
  failed: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  reserveLineWebhookEvent: dbMocks.reserve,
  markLineWebhookEventSucceeded: dbMocks.succeeded,
  markLineWebhookEventFailed: dbMocks.failed,
}));

import { classifyLineWebhookError, processLineWebhookEvents } from './line-webhook-events.js';

function event(id: string, text = '個人情報を含む本文'): WebhookEvent {
  return {
    type: 'message',
    replyToken: `reply-${id}`,
    message: { type: 'text', id: `message-${id}`, text },
    timestamp: 0,
    source: { type: 'user', userId: `U-sensitive-${id}` },
    webhookEventId: id,
    deliveryContext: { isRedelivery: false },
    mode: 'active',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.reserve.mockResolvedValue(true);
  dbMocks.succeeded.mockResolvedValue(undefined);
  dbMocks.failed.mockResolvedValue(undefined);
});

describe('processLineWebhookEvents', () => {
  test('同じイベントIDの再送は処理しない', async () => {
    dbMocks.reserve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const handle = vi.fn().mockResolvedValue(undefined);
    const events = [event('evt-1'), event('evt-1')];

    await processLineWebhookEvents({ db: {} as D1Database, events, lineAccountId: 'account-1', handle });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(dbMocks.succeeded).toHaveBeenCalledTimes(1);
    expect(dbMocks.failed).not.toHaveBeenCalled();
  });

  test('失敗を分類して記録し、同じリクエストの次のイベントを処理する', async () => {
    const rawException = '顧客名と秘密の本文を含む例外';
    const handle = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error(rawException), { name: 'LineApiError', status: 500 }))
      .mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await processLineWebhookEvents({
      db: {} as D1Database,
      events: [event('evt-failed', '秘密のメッセージ'), event('evt-next')],
      lineAccountId: 'account-1',
      handle,
    });

    expect(handle).toHaveBeenCalledTimes(2);
    expect(dbMocks.failed).toHaveBeenCalledWith(expect.anything(), 'evt-failed', 'line_api_error');
    expect(dbMocks.succeeded).toHaveBeenCalledWith(expect.anything(), 'evt-next');
    const output = JSON.stringify(errorSpy.mock.calls);
    expect(output).not.toContain(rawException);
    expect(output).not.toContain('秘密のメッセージ');
    expect(output).not.toContain('U-sensitive');
    errorSpy.mockRestore();
  });

  test('成功したイベントをsucceededにする', async () => {
    await processLineWebhookEvents({
      db: {} as D1Database,
      events: [event('evt-ok')],
      lineAccountId: 'account-1',
      handle: vi.fn().mockResolvedValue(undefined),
    });

    expect(dbMocks.succeeded).toHaveBeenCalledWith(expect.anything(), 'evt-ok');
    expect(dbMocks.failed).not.toHaveBeenCalled();
  });

  test('台帳予約が2回失敗しても台帳なしの印を残して処理する', async () => {
    dbMocks.reserve.mockRejectedValue(new Error('private database detail'));
    const handle = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await processLineWebhookEvents({
      db: {} as D1Database,
      events: [event('evt-ledger-down')],
      lineAccountId: 'account-1',
      handle,
    });

    expect(dbMocks.reserve).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledOnce();
    expect(dbMocks.succeeded).not.toHaveBeenCalled();
    expect(JSON.stringify(warnSpy.mock.calls)).toContain('line_webhook_ledger_unavailable_processed');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('個人情報を含む本文');
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('初回の台帳予約だけ失敗した場合は再試行して通常どおり記録する', async () => {
    dbMocks.reserve.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await processLineWebhookEvents({
      db: {} as D1Database,
      events: [event('evt-recovered')],
      lineAccountId: 'account-1',
      handle: vi.fn().mockResolvedValue(undefined),
    });

    expect(dbMocks.reserve).toHaveBeenCalledTimes(2);
    expect(dbMocks.succeeded).toHaveBeenCalledWith(expect.anything(), 'evt-recovered');
    errorSpy.mockRestore();
  });

  test('分類できない生の例外本文はunknownへ丸める', () => {
    expect(classifyLineWebhookError(new Error('raw database row and personal text'))).toBe('unknown');
    expect(classifyLineWebhookError(Object.assign(new Error('failure'), { name: 'D1Error' }))).toBe('db_error');
    expect(classifyLineWebhookError(new Error('LINE API error: 500 response body'))).toBe('line_api_error');
  });
});
