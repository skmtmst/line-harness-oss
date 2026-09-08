import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkWebhookUrlSafety,
  deliverWebhook,
  isSafeWebhookUrl,
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

/** 名前引きは外へ出ない。公開IPだけ返す決め打ち。 */
const publicOnlyLookup = async (_host: string) => ['93.184.216.34'];

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
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 3 }, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res).toMatchObject({ ok: true, attempts: 1, lastStatus: 200 });
    expect(count()).toBe(1);
  });

  it('500 は失敗として扱う（以前は成功扱いだった）', async () => {
    const count = stubFetch([500]);
    const res = await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res.ok).toBe(false);
    expect(res.lastStatus).toBe(500);
    // max_retries = 0 なので送り直さない。
    expect(count()).toBe(1);
  });

  it('送り直しの回数だけ試す', async () => {
    const count = stubFetch([500]);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 2 }, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(3); // 初回 + 2回
    expect(count()).toBe(3);
  });

  it('途中で成功したらそこで止める', async () => {
    const count = stubFetch([500, 200]);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 3 }, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res).toMatchObject({ ok: true, attempts: 2 });
    expect(count()).toBe(2);
  });

  it('4xx なら残りの回数を使わずに諦める', async () => {
    const count = stubFetch([400]);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 5 }, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res).toMatchObject({ ok: false, attempts: 1, lastStatus: 400 });
    expect(count()).toBe(1);
  });

  it('接続そのものが失敗しても例外を投げない', async () => {
    // 送信の失敗でイベント処理そのものを止めたくない。
    stubFetch(['throw']);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 1 }, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res).toMatchObject({ ok: false, lastStatus: null });
  });

  it('送り直しの上限は5回まで', async () => {
    const count = stubFetch([500]);
    await deliverWebhook({ ...WEBHOOK, max_retries: 99 }, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(count()).toBe(6); // 初回 + 5回
  });

  it('null の設定は送り直さないとして扱う', async () => {
    const count = stubFetch([500]);
    await deliverWebhook({ ...WEBHOOK, max_retries: null }, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(count()).toBe(1);
  });

  it('シークレットがあれば署名を付ける', async () => {
    stubFetch([200]);
    await deliverWebhook({ ...WEBHOOK, secret: 'a'.repeat(32) }, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    const call = vi.mocked(fetch).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Webhook-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('シークレットが無ければ署名は付けない', async () => {
    stubFetch([200]);
    await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    const call = vi.mocked(fetch).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Webhook-Signature']).toBeUndefined();
  });

  it('同じ出来事を送り直しても受け手が二重処理を防げる配送IDを付ける', async () => {
    stubFetch([200]);
    await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, idempotencyKey: 'delivery-1', lookupHost: publicOnlyLookup });
    const call = vi.mocked(fetch).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Webhook-Delivery-Id']).toBe('delivery-1');
  });
});

describe('送り先の文字面の検査', () => {
  it('公開HTTPSの名前は通す(既存の送信契約を維持)', () => {
    expect(isSafeWebhookUrl('https://hooks.example.com/events')).toBe(true);
    expect(isSafeWebhookUrl('https://example.com/hook')).toBe(true);
  });

  it('非HTTPS・認証情報付き・壊れたURLは止める', () => {
    expect(isSafeWebhookUrl('http://example.com/hook')).toBe(false);
    expect(isSafeWebhookUrl('https://user:pass@example.com/hook')).toBe(false);
    expect(isSafeWebhookUrl('not a url')).toBe(false);
  });

  it('loopback・private・link-local・metadataは止める', () => {
    for (const url of [
      'https://127.0.0.1/hook',
      'https://10.0.0.9/hook',
      'https://172.16.4.4/hook',
      'https://172.31.255.1/hook',
      'https://192.168.1.2/hook',
      'https://0.0.0.0/hook',
      'https://169.254.169.254/latest/meta-data/',
      'https://100.64.0.1/hook',
      'https://[::1]/hook',
      'https://[::]/hook',
      'https://[fd00::1]/hook',
      'https://[fe80::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://localhost/hook',
      'https://api.example.local/hook',
      'https://api.example.internal/hook',
      'https://metadata.google.internal/computeMetadata/v1/',
    ]) {
      expect(isSafeWebhookUrl(url)).toBe(false);
    }
  });

  it('16進・8進・整数の書き方でも抜け道を作らない', () => {
    expect(isSafeWebhookUrl('https://0x7f.0.0.1/hook')).toBe(false);
    expect(isSafeWebhookUrl('https://0177.0.0.1/hook')).toBe(false);
    expect(isSafeWebhookUrl('https://2130706433/hook')).toBe(false);
    expect(isSafeWebhookUrl('https://0x7f000001/hook')).toBe(false);
  });

  it('IPv6 link-localはfe80〜febfの全範囲を止める', () => {
    for (const url of [
      'https://[fe80::1]/hook',
      'https://[fe90::1]/hook',
      'https://[fea0::1]/hook',
      'https://[febf:ffff::1]/hook',
      'https://[0:0:0:0:0:0:0:1]/hook',
      'https://[0:0:0:0:0:0:0:0]/hook',
      'https://[2002:0a00:0001::1]/hook',
    ]) {
      expect(isSafeWebhookUrl(url)).toBe(false);
    }
  });

  it('公開IPv6は通す', () => {
    expect(isSafeWebhookUrl('https://[2606:4700:4700::1111]/hook')).toBe(true);
    expect(isSafeWebhookUrl('https://[::ffff:93.184.216.34]/hook')).toBe(true);
  });
});

describe('送信直前の再検査', () => {
  it('安全でない送り先は1度も送らずに止める', async () => {
    const count = stubFetch([200]);
    const res = await deliverWebhook(
      { ...WEBHOOK, url: 'https://169.254.169.254/x', max_retries: 2 },
      '{}',
      { sleep: noSleep, lookupHost: publicOnlyLookup },
    );
    expect(res).toMatchObject({ ok: false, lastStatus: null, blocked: true });
    expect(count()).toBe(0);
  });

  it('DNSが内部IPに変わっていたら送らない(DNS切替)', async () => {
    const count = stubFetch([200]);
    const res = await deliverWebhook(WEBHOOK, '{}', {
      sleep: noSleep,
      lookupHost: async () => ['127.0.0.1'],
    });
    expect(res).toMatchObject({ ok: false, lastStatus: null, blocked: true });
    expect(count()).toBe(0);
  });

  it('DNSに公開と内部が混ざっていたら送らない', async () => {
    const count = stubFetch([200]);
    const res = await deliverWebhook(WEBHOOK, '{}', {
      sleep: noSleep,
      lookupHost: async () => ['93.184.216.34', '10.1.2.3'],
    });
    expect(res.blocked).toBe(true);
    expect(count()).toBe(0);
  });

  it('文字面で止まるときは名前を引かない', async () => {
    const lookup = vi.fn(async (_host: string) => ['93.184.216.34']);
    const verdict = await checkWebhookUrlSafety('https://127.0.0.1/x', { lookupHost: lookup });
    expect(verdict).toEqual({ ok: false, reason: 'blocked_ip' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('転送先が内部を向いたら辿らずに止める', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input) === 'https://example.com/hook') {
          return new Response('', { status: 302, headers: { location: 'https://169.254.169.254/x' } });
        }
        throw new Error(`送ってはいけない先: ${String(input)}`);
      }),
    );
    const res = await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res).toMatchObject({ ok: false, lastStatus: null, blocked: true });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('非HTTPSへの転送は辿らずに止める', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 307, headers: { location: 'http://example.com/plain' } })),
    );
    const res = await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res.blocked).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('公開先への転送は辿って送る', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        seen.push(String(input));
        if (String(input) === 'https://example.com/hook') {
          return new Response('', { status: 302, headers: { location: '/next' } });
        }
        return new Response('', { status: 200 });
      }),
    );
    const res = await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res).toMatchObject({ ok: true, attempts: 1, lastStatus: 200 });
    expect(seen).toEqual(['https://example.com/hook', 'https://example.com/next']);
  });

  it('送り直しのたびに引き直す(2回目に内部IPなら止まる)', async () => {
    const count = stubFetch([500, 200]);
    const lookup = vi.fn(async (_host: string) => ['93.184.216.34']);
    lookup.mockResolvedValueOnce(['93.184.216.34']);
    lookup.mockResolvedValueOnce(['10.9.9.9']);
    const res = await deliverWebhook({ ...WEBHOOK, max_retries: 2 }, '{}', {
      sleep: noSleep,
      lookupHost: lookup,
    });
    // 1回目は公開IPで送って500、2回目は引き直して内部IPで止まる。
    expect(res).toMatchObject({ ok: false, blocked: true, attempts: 2 });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(count()).toBe(1);
  });

  it('名前が引けない・空のときは送らない(fail-closed)', async () => {
    const throwing = stubFetch([200]);
    const failed = await deliverWebhook(WEBHOOK, '{}', {
      sleep: noSleep,
      lookupHost: async () => { throw new Error('dns down'); },
    });
    expect(failed).toMatchObject({ ok: false, lastStatus: null, blocked: true, blockReason: 'dns_unresolved' });
    expect(throwing()).toBe(0);

    const empty = stubFetch([200]);
    const noAnswer = await deliverWebhook(WEBHOOK, '{}', {
      sleep: noSleep,
      lookupHost: async () => [],
    });
    expect(noAnswer).toMatchObject({ ok: false, blocked: true, blockReason: 'dns_unresolved' });
    expect(empty()).toBe(0);
  });

  it('別originへの転送では署名・冪等・本文の頭を持ち越さない', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        if (String(input) === 'https://example.com/hook') {
          return new Response('', { status: 302, headers: { location: 'https://other.example/next' } });
        }
        return new Response('', { status: 200 });
      }),
    );
    const res = await deliverWebhook(
      { ...WEBHOOK, secret: 'a'.repeat(32) },
      '{"a":1}',
      { sleep: noSleep, idempotencyKey: 'delivery-9', lookupHost: publicOnlyLookup },
    );
    expect(res).toMatchObject({ ok: true, lastStatus: 200 });
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/hook', 'https://other.example/next']);
    const first = calls[0].init.headers as Record<string, string>;
    const second = calls[1].init.headers as Record<string, string>;
    expect(first['X-Webhook-Signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(second['X-Webhook-Signature']).toBeUndefined();
    expect(second['X-Webhook-Delivery-Id']).toBeUndefined();
    expect(second['Content-Type']).toBeUndefined();
  });

  it('本文付きのまま別originへ転送する応答は止める', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input) === 'https://example.com/hook') {
          return new Response('', { status: 307, headers: { location: 'https://other.example/next' } });
        }
        throw new Error(`送ってはいけない先: ${String(input)}`);
      }),
    );
    const res = await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, lookupHost: publicOnlyLookup });
    expect(res).toMatchObject({ ok: false, blocked: true, blockReason: 'unsafe_redirect' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('同じoriginの307転送は署名を保って辿る', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        if (String(input) === 'https://example.com/hook') {
          return new Response('', { status: 307, headers: { location: '/next2' } });
        }
        return new Response('', { status: 200 });
      }),
    );
    const res = await deliverWebhook(
      { ...WEBHOOK, secret: 'a'.repeat(32) },
      '{"a":1}',
      { sleep: noSleep, lookupHost: publicOnlyLookup },
    );
    expect(res).toMatchObject({ ok: true, lastStatus: 200 });
    const second = calls[1].init.headers as Record<string, string>;
    expect(second['X-Webhook-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('検査時と接続時でDNS応答が異なれば送らない(分岐の再現)', async () => {
    // 検査時は公開IP、転送先を辿る段で引き直したら内部IPに変わっていた場合。
    // 転送先への接続は発生しない。
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.push(String(input));
        return new Response('', { status: 302, headers: { location: '/next' } });
      }),
    );
    const lookup = vi.fn(async (_host: string) => ['93.184.216.34']);
    lookup.mockResolvedValueOnce(['93.184.216.34']);
    lookup.mockResolvedValueOnce(['10.9.9.9']);
    const res = await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep, lookupHost: lookup });
    expect(res).toMatchObject({ ok: false, blocked: true });
    // 転送元への1回だけ。転送先へは送らない。
    expect(calls).toEqual(['https://example.com/hook']);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('既定の名前引き(DoH)でも内部IPを止める', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.startsWith('https://cloudflare-dns.com/dns-query')) {
          const type = new URL(url).searchParams.get('type');
          const qtype = type === 'A' ? 1 : 28;
          const data = type === 'A' ? '10.0.0.5' : '::1';
          return new Response(
            JSON.stringify({ Answer: [{ name: 'example.com.', type: qtype, TTL: 60, data }] }),
            { status: 200, headers: { 'content-type': 'application/dns-json' } },
          );
        }
        throw new Error(`送ってはいけない先: ${url}`);
      }),
    );
    // lookupHostを渡さない=本番と同じ既定の名前引きを使う。
    const res = await deliverWebhook(WEBHOOK, '{}', { sleep: noSleep });
    expect(res.blocked).toBe(true);
  });
});
