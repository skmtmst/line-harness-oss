// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RestaurantCustomerSlot, RestaurantReferralCandidate } from '@line-crm/shared';
vi.mock('@line/liff', () => ({ default: { getProfile: vi.fn().mockResolvedValue({ displayName: 'テスト' }), closeWindow: vi.fn() } }));
vi.mock('../../lib/api.js', () => ({
  api: { customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: { liff_theme: 'line' } } }), liffConfig: vi.fn().mockResolvedValue({ success: true, data: { accountName: '見本店' } }), bookingSettings: vi.fn().mockResolvedValue({}) },
  restaurantBookingApi: { link: vi.fn(), courses: vi.fn(), referrals: vi.fn(), referral: vi.fn(), availability: vi.fn(), hold: vi.fn(), confirm: vi.fn(), mine: vi.fn(), cancel: vi.fn(), reschedule: vi.fn() },
}));
vi.mock('../../lib/user-message.js', async load => ({ ...await load<typeof import('../../lib/user-message.js')>(), logFailure: vi.fn() }));
const { restaurantBookingApi: seat } = await import('../../lib/api.js');
const { default: SeatReserve } = await import('./seat-reserve.js');
const startsAt = '2026-10-07T09:00:00.000Z';
const candidate: RestaurantReferralCandidate = { storeId: 'other', storeName: '駅前店', distanceKm: 1.2, startsAt, endsAt: '2026-10-07T11:00:00.000Z', bookingUrl: 'https://liff.line.me/target?page=restaurant&token=dest' };
function open() { render(<MemoryRouter initialEntries={['/restaurant/reserve/tok']}><Routes><Route path="/restaurant/reserve/:token" element={<SeatReserve />} /></Routes></MemoryRouter>); }
function section() { return screen.getByRole('region', { name: '系列店の案内' }); }
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(seat.referrals).mockReset(); vi.mocked(seat.referral).mockReset(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
  vi.mocked(seat.link).mockResolvedValue({ success: true, data: { id: 'store', name: '本店', timezone: 'Asia/Tokyo' } }); vi.mocked(seat.courses).mockResolvedValue({ success: true, data: [] });
  vi.mocked(seat.referrals).mockResolvedValue({ success: true, data: [candidate] });
  vi.mocked(seat.availability).mockImplementation(async (_store, date, guestCount) => ({ success: true, data: { storeId: 'store', date, guestCount, slots: [{ startsAt: `${date}T09:00:00.000Z`, endsAt: `${date}T11:00:00.000Z`, available: false, remainingTables: 0, seatTypes: ['table'] } satisfies RestaurantCustomerSlot], cancelDeadlineMinutesBefore: 120, cutoffMinutesBefore: 60 } }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('系列店の空き時刻の案内', () => {
  it('空き時刻は操作しない札として示し、紹介と席確保を実行しない', async () => {
    open(); const badge = await screen.findByText('18:00 空きあり'); expect(badge.closest('button')).toBeNull();
    expect(within(section()).queryByRole('button', { name: '案内先の時刻' })).toBeNull();
    fireEvent.click(badge); expect(seat.referral).not.toHaveBeenCalled(); expect(seat.hold).not.toHaveBeenCalled(); expect(seat.confirm).not.toHaveBeenCalled();
    expect(within(section()).getByRole('button', { name: 'この店で予約する' })).toHaveProperty('disabled', false);
    expect(within(section()).getByText('1.2km')).toBeTruthy();
  });
  it('同じ瞬間を既存の表示元の店タイムゾーンで示す', async () => {
    vi.mocked(seat.link).mockResolvedValue({ success: true, data: { id: 'store', name: '本店', timezone: 'America/New_York' } });
    open(); expect(await screen.findByText('05:00 空きあり')).toBeTruthy(); expect(seat.referral).not.toHaveBeenCalled();
  });
  it('案内候補が無ければ空き時刻や移動操作を作らない', async () => {
    vi.mocked(seat.referrals).mockResolvedValue({ success: true, data: [] }); open(); await screen.findByText('案内できるお店の空きがありません。ほかの日を選んでください。');
    expect(within(section()).queryByText(/空きあり/)).toBeNull(); expect(within(section()).queryByRole('button', { name: 'この店で予約する' })).toBeNull();
  });
  it('取得失敗から同じ条件の読み直しで札を表示する', async () => {
    vi.mocked(seat.referrals).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true, data: [candidate] }); open();
    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' }); fireEvent.click(retry); await screen.findByText('18:00 空きあり');
    expect(vi.mocked(seat.referrals).mock.calls[0]).toEqual(vi.mocked(seat.referrals).mock.calls[1]); expect(seat.referral).not.toHaveBeenCalled();
  });
  it('移動操作だけが元の本文で紹介し、処理中の連打を止める', async () => {
    let reject: (reason: Error) => void = () => {}; vi.mocked(seat.referral).mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
    open(); await screen.findByText('18:00 空きあり'); const button = within(section()).getByRole('button', { name: 'この店で予約する' }); fireEvent.click(button); fireEvent.click(button);
    expect(seat.referral).toHaveBeenCalledExactlyOnceWith({ storeId: 'store', targetStoreId: 'other', date: '2026-10-07', startsAt, guestCount: 2, courseId: null }); expect(button).toHaveProperty('disabled', true);
    reject(new Error('offline')); await waitFor(() => expect(button).toHaveProperty('disabled', false)); expect(seat.hold).not.toHaveBeenCalled(); expect(seat.confirm).not.toHaveBeenCalled();
  });
});
