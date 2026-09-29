import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  classifyLineOutboundFailure,
  completeOutboundSendStatement,
  failOutboundSend,
  hashOutboundPayload,
  isValidIdempotencyKey,
  reserveOutboundSend,
} from './outbound-idempotency.js';

const KEY = '123e4567-e89b-42d3-a456-426614174000';
const NOW = '2026-08-21T00:00:00.000Z';

describe('outbound send idempotency boundary', () => {
  let sqlite: SqliteD1;

  beforeEach(() => {
    sqlite = createTestD1();
  });

  afterEach(() => sqlite.raw.close());

  test('メールの並行再試行は外部送信へ進めない', async () => {
    const args = {
      key: KEY,
      channel: 'email' as const,
      resourceId: 'thread-1',
      payloadHash: await hashOutboundPayload('same body'),
      retryInProgress: false,
      now: NOW,
    };
    await expect(reserveOutboundSend(sqlite.db, args)).resolves.toMatchObject({ kind: 'acquired' });
    await expect(reserveOutboundSend(sqlite.db, args)).resolves.toEqual({ kind: 'in_progress' });
  });

  test('古いLINE経路だけは同じleaseで処理途中再試行を維持する', async () => {
    const args = {
      key: KEY,
      channel: 'line' as const,
      resourceId: 'chat-1',
      payloadHash: await hashOutboundPayload('same message'),
      retryInProgress: true,
      now: NOW,
    };
    const first = await reserveOutboundSend(sqlite.db, args);
    expect(first).toMatchObject({ kind: 'acquired' });
    const retry = await reserveOutboundSend(sqlite.db, args);
    expect(retry).toMatchObject({ kind: 'retry' });
    if (first.kind === 'acquired' && retry.kind === 'retry') {
      expect(retry.leaseToken).toBe(first.leaseToken);
    }
  });

  test('完了した送信は外部送信せず同じ結果を返す', async () => {
    const args = {
      key: KEY,
      channel: 'line' as const,
      resourceId: 'chat-1',
      payloadHash: await hashOutboundPayload('hello'),
      retryInProgress: false,
      now: NOW,
    };
    const reserved = await reserveOutboundSend(sqlite.db, args);
    if (reserved.kind !== 'acquired') throw new Error('reservation failed');
    await completeOutboundSendStatement(sqlite.db, {
      key: KEY,
      responseId: 'message-1',
      leaseToken: reserved.leaseToken,
      now: args.now,
    }).run();
    await expect(reserveOutboundSend(sqlite.db, args)).resolves.toEqual({
      kind: 'replay',
      responseId: 'message-1',
    });
  });

  test('同じキーの本文・宛先・チャネル・account差し替えを拒否する', async () => {
    await reserveOutboundSend(sqlite.db, {
      key: KEY,
      channel: 'line',
      resourceId: 'friend-1',
      payloadHash: await hashOutboundPayload('first'),
      lineAccountId: 'account-1',
      retryInProgress: false,
      now: NOW,
    });
    await expect(reserveOutboundSend(sqlite.db, {
      key: KEY,
      channel: 'email',
      resourceId: 'thread-2',
      payloadHash: await hashOutboundPayload('second'),
      lineAccountId: 'account-2',
      retryInProgress: false,
      now: '2026-08-21T00:00:01.000Z',
    })).resolves.toEqual({ kind: 'conflict' });
  });

  test('再試行可能な失敗はCASで1実行者だけが回収する', async () => {
    const args = {
      key: KEY,
      channel: 'line' as const,
      resourceId: 'chat-1',
      payloadHash: await hashOutboundPayload('hello'),
      lineAccountId: 'account-1',
      retryInProgress: false,
      now: NOW,
    };
    const first = await reserveOutboundSend(sqlite.db, args);
    if (first.kind !== 'acquired') throw new Error('reservation failed');
    await failOutboundSend(sqlite.db, {
      key: KEY,
      leaseToken: first.leaseToken,
      status: 'failed',
      code: 'LINE_RATE_LIMITED',
      retryable: true,
      nextRetryAt: NOW,
      now: NOW,
    });

    const [a, b] = await Promise.all([
      reserveOutboundSend(sqlite.db, args),
      reserveOutboundSend(sqlite.db, args),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(['in_progress', 'retry']);
    expect(sqlite.raw.prepare(
      `SELECT attempt_count FROM outbound_send_requests WHERE idempotency_key = ?`,
    ).get(KEY)).toEqual({ attempt_count: 2 });
  });

  test('送達不明は同じキーでも再送しない', async () => {
    const args = {
      key: KEY,
      channel: 'line' as const,
      resourceId: 'chat-1',
      payloadHash: await hashOutboundPayload('hello'),
      lineAccountId: 'account-1',
      retryInProgress: false,
      now: NOW,
    };
    const first = await reserveOutboundSend(sqlite.db, args);
    if (first.kind !== 'acquired') throw new Error('reservation failed');
    await failOutboundSend(sqlite.db, {
      key: KEY,
      leaseToken: first.leaseToken,
      status: 'unknown',
      code: 'LINE_DELIVERY_UNKNOWN',
      retryable: false,
      nextRetryAt: null,
      now: NOW,
    });
    await expect(reserveOutboundSend(sqlite.db, args)).resolves.toEqual({
      kind: 'unknown', code: 'LINE_DELIVERY_UNKNOWN',
    });
  });

  test('LINE例外本文を保存対象へ入れず安全codeだけに分類する', () => {
    expect(classifyLineOutboundFailure(
      Object.assign(new Error('secret response body'), { status: 429, retryAfter: '30' }),
      NOW,
    )).toMatchObject({
      status: 'failed', code: 'LINE_RATE_LIMITED', retryable: true,
    });
    expect(classifyLineOutboundFailure(new TypeError('network secret'), NOW)).toEqual({
      status: 'unknown',
      code: 'LINE_DELIVERY_UNKNOWN',
      retryable: false,
      nextRetryAt: null,
      httpStatus: 503,
    });
  });

  test('UUID形式以外のキーを拒否する', () => {
    expect(isValidIdempotencyKey(KEY)).toBe(true);
    expect(isValidIdempotencyKey('same-message')).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
  });
});
