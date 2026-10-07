import { afterEach, describe, expect, test, vi } from 'vitest';
import type { BookingHistoryResponse } from '@line-crm/shared';

vi.mock('./liff-auth.js', () => ({ getIdToken: () => 'test-token', getLiffId: () => 'test-liff' }));
import { api } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('本人の予約履歴と変更のAPI', () => {
  test('履歴の版を変更・取消へ送り、本人確認とLIFF IDを付ける', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    const history = {
      upcoming: [{ id: '予約/1', starts_at: '2026-11-02T15:00:00.000Z', status: 'confirmed',
        lock_version: 7, menu_id: 'menu-1', staff_id: 'staff-1', menu_name: '相談',
        staff_name: '担当', profile_image_url: null }],
      past: [],
    } satisfies BookingHistoryResponse;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(history)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'confirmed', lock_version: 8 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'cancelled', lock_version: 8 })));
    vi.stubGlobal('fetch', fetcher);
    const mine = await api.me();
    expect(mine).toEqual(history);
    const changed = await api.rescheduleMyBooking(mine.upcoming[0].id, {
      lock_version: mine.upcoming[0].lock_version, starts_at: '2026-11-03T15:00:00.000Z',
    });
    await api.cancelMyBooking(mine.upcoming[0].id, changed.lock_version);
    const calls = fetcher.mock.calls;
    expect(calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/liff/booking/me', '/api/liff/booking/%E4%BA%88%E7%B4%84%2F1/reschedule',
      '/api/liff/booking/%E4%BA%88%E7%B4%84%2F1/cancel',
    ]);
    for (const [url, init] of calls) {
      expect(new URL(String(url)).searchParams.get('liffId')).toBe('test-liff');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    }
    expect(calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ lock_version: 7, starts_at: '2026-11-03T15:00:00.000Z' }) });
    expect(calls[2][1]).toMatchObject({ method: 'POST', body: '{"lock_version":8}' });
  });

  test('変更・取消の版競合を隠さず画面へ返す', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"version_conflict"}', { status: 409 })));
    await expect(api.rescheduleMyBooking('b1', { lock_version: 1, starts_at: '2026-11-03T15:00:00.000Z' }))
      .rejects.toMatchObject({ status: 409, body: { error: 'version_conflict' } });
    await expect(api.cancelMyBooking('b1', 1))
      .rejects.toMatchObject({ status: 409, body: { error: 'version_conflict' } });
  });
});
