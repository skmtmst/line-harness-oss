import { describe, expect, test } from 'vitest';
import {
  completeOutboundSendStatement,
  hashOutboundPayload,
  isValidIdempotencyKey,
  reserveOutboundSend,
} from './outbound-idempotency.js';

type Row = {
  channel: 'line' | 'email';
  resource_id: string;
  payload_hash: string;
  status: 'in_progress' | 'succeeded';
  response_id: string | null;
};

function memDB(): D1Database {
  const rows = new Map<string, Row>();
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO outbound_send_requests')) {
            const [key, channel, resourceId, payloadHash] = bound as [string, 'line' | 'email', string, string];
            if (rows.has(key)) return { success: true, meta: { changes: 0 } };
            rows.set(key, {
              channel,
              resource_id: resourceId,
              payload_hash: payloadHash,
              status: 'in_progress',
              response_id: null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'succeeded'")) {
            const [responseId, , , key] = bound as [string, string, string, string];
            const row = rows.get(key);
            if (row) rows.set(key, { ...row, status: 'succeeded', response_id: responseId });
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async first<T>() {
          const row = rows.get(String(bound[0]));
          return (row ?? null) as T | null;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

const KEY = '123e4567-e89b-42d3-a456-426614174000';

describe('outbound send idempotency boundary', () => {
  test('メールの並行再試行は外部送信へ進めない', async () => {
    const db = memDB();
    const args = {
      key: KEY,
      channel: 'email' as const,
      resourceId: 'thread-1',
      payloadHash: await hashOutboundPayload('same body'),
      retryInProgress: false,
      now: '2026-08-21T00:00:00.000Z',
    };
    await expect(reserveOutboundSend(db, args)).resolves.toEqual({ kind: 'acquired' });
    await expect(reserveOutboundSend(db, args)).resolves.toEqual({ kind: 'in_progress' });
  });

  test('LINEの処理途中再試行は同じ上流再試行キーで続行できる', async () => {
    const db = memDB();
    const args = {
      key: KEY,
      channel: 'line' as const,
      resourceId: 'chat-1',
      payloadHash: await hashOutboundPayload('same message'),
      retryInProgress: true,
      now: '2026-08-21T00:00:00.000Z',
    };
    await expect(reserveOutboundSend(db, args)).resolves.toEqual({ kind: 'acquired' });
    await expect(reserveOutboundSend(db, args)).resolves.toEqual({ kind: 'retry' });
  });

  test('完了した送信は外部送信せず同じ結果を返す', async () => {
    const db = memDB();
    const args = {
      key: KEY,
      channel: 'line' as const,
      resourceId: 'chat-1',
      payloadHash: await hashOutboundPayload('hello'),
      retryInProgress: true,
      now: '2026-08-21T00:00:00.000Z',
    };
    await reserveOutboundSend(db, args);
    await completeOutboundSendStatement(db, {
      key: KEY,
      responseId: 'message-1',
      now: args.now,
    }).run();
    await expect(reserveOutboundSend(db, args)).resolves.toEqual({
      kind: 'replay',
      responseId: 'message-1',
    });
  });

  test('同じキーの本文・宛先・チャネル差し替えを拒否する', async () => {
    const db = memDB();
    await reserveOutboundSend(db, {
      key: KEY,
      channel: 'line',
      resourceId: 'friend-1',
      payloadHash: await hashOutboundPayload('first'),
      retryInProgress: true,
      now: '2026-08-21T00:00:00.000Z',
    });
    await expect(reserveOutboundSend(db, {
      key: KEY,
      channel: 'email',
      resourceId: 'thread-2',
      payloadHash: await hashOutboundPayload('second'),
      retryInProgress: false,
      now: '2026-08-21T00:00:01.000Z',
    })).resolves.toEqual({ kind: 'conflict' });
  });

  test('UUID形式以外のキーを拒否する', () => {
    expect(isValidIdempotencyKey(KEY)).toBe(true);
    expect(isValidIdempotencyKey('same-message')).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
  });
});
