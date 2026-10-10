import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./liff-auth.js', () => ({ getIdToken: () => 'test-token', getLiffId: () => 'test-liff' }));
import { api } from './api.js';
afterEach(() => vi.unstubAllGlobals());

describe('クーポンQRのLIFF API', () => {
  it('本人確認を付け、応答の包みを外す。使用の再試行では同じ操作番号を渡す', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    const receipt = { receiptId: 'receipt', assetId: 'coupon', name: '割引', payload: {}, receivedAt: '2026-10-10', usedCount: 0, postbackData: 'coupon_use:coupon:receipt' };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: receipt })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { message: '使用を記録しました', replayed: false } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { message: '使用を記録しました', replayed: true } })));
    vi.stubGlobal('fetch', fetcher);
    expect(await api.entryRouteCoupon.receive('shop')).toEqual(receipt);
    await api.entryRouteCoupon.use('receipt', 'same-request');
    expect(await api.entryRouteCoupon.use('receipt', 'same-request')).toMatchObject({ replayed: true });
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/liff/entry-route-coupon', '/api/liff/entry-route-coupon/use', '/api/liff/entry-route-coupon/use',
    ]);
    for (const [url, init] of fetcher.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
      expect(new URL(String(url)).searchParams.get('liffId')).toBe('test-liff');
    }
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[2][1]?.body);
  });
  it('受け取れない理由を状態番号と本文ごと返す', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"success":false,"error":"停止中"}', { status: 409 })));
    await expect(api.entryRouteCoupon.receive('shop')).rejects.toMatchObject({ status: 409, body: { error: '停止中' } });
  });
});
