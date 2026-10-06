import { afterEach, describe, expect, test, vi } from 'vitest';
vi.mock('./liff-auth.js', () => ({ getIdToken: () => '試験用本人確認', getLiffId: () => '試験用LIFF' }));
import { api } from './api.js';
afterEach(() => vi.unstubAllGlobals());
describe('イベント待ちのAPI呼び出し', () => {
  test('案内の鍵をURL符号化して本人確認とLIFF IDを添えて取得する', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { remainingSeconds: 60 } })));
    vi.stubGlobal('fetch', fetcher);
    expect(await api.eventWaitlistOffer('試験/鍵')).toEqual({ success: true, data: { remainingSeconds: 60 } });
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain('/api/liff/events/waitlist/%E8%A9%A6%E9%A8%93%2F%E9%8D%B5');
    expect(new URL(String(url)).searchParams.get('liffId')).toBe('試験用LIFF');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer 試験用本人確認' });
  });
});
