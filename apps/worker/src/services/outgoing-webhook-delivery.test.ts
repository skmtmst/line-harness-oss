import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deliverWebhook,
  retryDelayMs,
  shouldRetryStatus,
  type WebhookRow,
} from './outgoing-webhook-delivery.js';

const WEBHOOK: WebhookRow = {
  id: 'wh-1',
  url: 'https://example.com/hook',
  secret: null,
  max_retries: 0,
};

/** 待ち時間は実際には待たない。テストを秒単位で遅くしないため。 */
const noSleep = () => Promise.resolve();

afterEach(() => vi.unstubAllGlobals());

function stubFetch(statuses: Array<number | 'throw'>) {
  const calls: number[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = statuses[Math.min(i, statuses.length - 1)];
      i++;
      calls.push(i);
      if (next === 'throw') throw new Error('connection refused');
      return { ok: next >= 200 && next < 300, status: next } as Response;
    }),
  );
  return () => i;
}

describe('待ち時間', () => {
  it('倍にしていって8秒で頭打ち', () => {
    expect(retryDelayMs(0)).toBe(500);
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(2)).toBe(2000);
    expect(retryDelayMs(10)).toBe(8000);
  });
});

describe('送り直す価値のある応答か', () => {
  it('5xx は送り直す', () => {
    expect(shouldRetryStatus(500)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
  });

  it('4xx は送り直さない', () => {
    // 相手が「この内容は受け取れない」と言っているので、同じものを
    // 送り直しても結果は変わらない。
    expect(shouldRetryStatus(400)).toBe(false);
    expect(shouldRetryStatus(404)).toBe(false);
  });

  it('429 だけは例外', () => {
    expect(shouldRetryStatus(429)).toBe(true);
  });
});

describe('配送', () => {
  it('200 なら1回で終わる', async () => {
    const count = stubFetch([200]);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 3 }, '{}', { sleep: noSleep });
    expect(res).toMatchObject({ ok: true, attempts: 1, lastStatus: 200 });
    expect(count()).toBe(1);
  });

  it('500 は失敗として扱う（以前は成功扱いだった）', async () => {
    const count = stubFetch([500]);
    const res = await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep });
    expect(res.ok).toBe(false);
    expect(res.lastStatus).toBe(500);
    // max_retries = 0 なので送り直さない。
    expect(count()).toBe(1);
  });

  it('送り直しの回数だけ試す', async () => {
    const count = stubFetch([500]);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 2 }, '{}', { sleep: noSleep });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(3); // 初回 + 2回
    expect(count()).toBe(3);
  });

  it('途中で成功したらそこで止める', async () => {
    const count = stubFetch([500, 200]);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 3 }, '{}', { sleep: noSleep });
    expect(res).toMatchObject({ ok: true, attempts: 2 });
    expect(count()).toBe(2);
  });

  it('4xx なら残りの回数を使わずに諦める', async () => {
    const count = stubFetch([400]);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 5 }, '{}', { sleep: noSleep });
    expect(res).toMatchObject({ ok: false, attempts: 1, lastStatus: 400 });
    expect(count()).toBe(1);
  });

  it('接続そのものが失敗しても例外を投げない', async () => {
    // 送信の失敗でイベント処理そのものを止めたくない。
    stubFetch(['throw']);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 1 }, '{}', { sleep: noSleep });
    expect(res).toMatchObject({ ok: false, lastStatus: null });
  });

  it('送り直しの上限は5回まで', async () => {
    const count = stubFetch([500]);
    await deliverWebhook({ ...WEBHOOK, max_retries: 99 }, '{}', { sleep: noSleep });
    expect(count()).toBe(6); // 初回 + 5回
  });

  it('null の設定は送り直さないとして扱う', async () => {
    const count = stubFetch([500]);
    await deliverWebhook({ ...WEBHOOK, max_retries: null }, '{}', { sleep: noSleep });
    expect(count()).toBe(1);
  });

  it('シークレットがあれば署名を付ける', async () => {
    stubFetch([200]);
    await deliverWebhook({ ...WEBHOOK, secret: 'a'.repeat(32) }, '{}', { sleep: noSleep });
    const call = vi.mocked(fetch).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Webhook-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('シークレットが無ければ署名は付けない', async () => {
    stubFetch([200]);
    await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep });
    const call = vi.mocked(fetch).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Webhook-Signature']).toBeUndefined();
  });

  it('同じ出来事を送り直しても受け手が二重処理を防げる配送IDを付ける', async () => {
    stubFetch([200]);
    await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, idempotencyKey: 'delivery-1' });
    const call = vi.mocked(fetch).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Webhook-Delivery-Id']).toBe('delivery-1');
  });
});
