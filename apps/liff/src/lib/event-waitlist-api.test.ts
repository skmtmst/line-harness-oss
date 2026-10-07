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
  test('本人の待ち一覧・個別取得・取り下げは専用の口へ送る', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetcher);
    await api.myEventWaitlist();
    await api.myEventWaitlistEntry('待ち/1');
    await api.cancelMyEventWaitlist('待ち/1');
    const calls = fetcher.mock.calls as unknown as [URL, RequestInit][];
    expect(new URL(String(calls[0][0])).pathname).toBe('/api/liff/events/me/waitlist');
    expect(new URL(String(calls[1][0])).pathname).toBe('/api/liff/events/me/waitlist/%E5%BE%85%E3%81%A1%2F1');
    expect(new URL(String(calls[2][0])).pathname).toBe('/api/liff/events/me/waitlist/%E5%BE%85%E3%81%A1%2F1/cancel');
    expect(calls[2][1]).toMatchObject({ method: 'POST', body: '{}' });
  });
  test('ウェビナーの人数取得は視聴状態とは別の口を読む', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ viewerCount: 2, lecturerName: null })));
    vi.stubGlobal('fetch', fetcher);
    expect(await api.webinarAudience('試験/配信')).toEqual({ viewerCount: 2, lecturerName: null });
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(new URL(url).pathname).toBe('/api/liff/webinars/%E8%A9%A6%E9%A8%93%2F%E9%85%8D%E4%BF%A1/audience');
  });
});
