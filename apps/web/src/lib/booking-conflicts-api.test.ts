import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingApi } from './api';

afterEach(() => vi.unstubAllGlobals());
describe('予約の重なりAPI関数', () => {
  it('アカウントをエンコードして表示材料を取得する', async () => {
    const payload = { success: true, data: { conflicts: [], notifyConflicts: true } };
    const fetchMock = vi.fn(async () => Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);
    expect(await bookingApi.getConflicts('a & b')).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/booking/admin/conflicts?account_id=a%20%26%20b');
    expect(init.method ?? 'GET').toBe('GET');
  });
  it.each([true, false])('既存のスタッフ変更口へ通知指定 %s をそのまま送る', async (notifyCustomer) => {
    const payload = { booking_id: 'b', customerNotification: { channel: 'phone', status: 'action_required' } };
    const fetchMock = vi.fn(async () => Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);
    const input = { staffId: 'staff2', notifyCustomer };
    expect(await bookingApi.reassignBooking('account', '予約/2', input)).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/booking/admin/bookings/%E4%BA%88%E7%B4%84%2F2/reassign?account_id=account');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
