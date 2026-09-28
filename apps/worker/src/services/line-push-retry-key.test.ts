/**
 * LINE 再試行キーの重複受付 (R343)。
 * 409 の両ヘッダー時は元の受理IDを残す。一斉配信など他の呼び出し元も
 * 同じ SDK を通るため、ここで共通の振る舞いを守る。
 */
import { describe, expect, test, vi, afterEach } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';

function stubFetch(handler: (url: string, init: Record<string, unknown>) => Response) {
  const spy = vi.fn(async (url: unknown, init: unknown) => handler(String(url), (init ?? {}) as Record<string, unknown>));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, headers: Record<string, string>, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('pushMessageWithRequestId の 409 (R343)', () => {
  test('両ヘッダー時は元の受理IDを返す', async () => {
    stubFetch(async () => jsonResponse(409, {
      'x-line-request-id': 'RETRY-2',
      'x-line-accepted-request-id': 'ORIGINAL-1',
    }));
    const client = new LineClient('token');
    const res = await client.pushMessageWithRequestId('U1', [{ type: 'text', text: 'hi' }], 'key-1');
    expect(res.requestId).toBe('ORIGINAL-1');
  });

  test('accepted のみ・通常200も維持する', async () => {
    stubFetch(async () => jsonResponse(409, { 'x-line-accepted-request-id': 'ORIGINAL-1' }));
    const client = new LineClient('token');
    const res = await client.pushMessageWithRequestId('U1', [{ type: 'text', text: 'hi' }], 'key-1');
    expect(res.requestId).toBe('ORIGINAL-1');
  });

  test('200 は要求IDをそのまま返す', async () => {
    const spy = stubFetch(async (_url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers['X-Line-Retry-Key']).toBe('key-1');
      return jsonResponse(200, { 'x-line-request-id': 'REQ-9' });
    });
    const client = new LineClient('token');
    const res = await client.pushMessageWithRequestId('U1', [{ type: 'text', text: 'hi' }], 'key-1');
    expect(res.requestId).toBe('REQ-9');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
