// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import WaitlistOfferSheet from './WaitlistOfferSheet.js';
const mocks = vi.hoisted(() => ({ bookingWaitlists: vi.fn(), seatWaitlists: vi.fn(), acceptWaitlist: vi.fn(), acceptSeatWaitlist: vi.fn(), cancelWaitlist: vi.fn(), cancelSeatWaitlist: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: mocks }));
vi.mock('./BookingPayment.js', () => ({ default: () => <div>お支払い</div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const offer = { id: 'w', staff_id: 's', menu_id: 'm', starts_at: '2099-01-01T05:00:00Z', ends_at: '2099-01-01T06:00:00Z', status: 'invited', hold_expires_at: '2099-01-01T04:00:00Z', hold_minutes: 30, created_at: '2026-01-01', menu_name: '試験メニュー', staff_name: '試験担当' };
describe('本人用の案内シート', () => {
  it('人の案内を通常の予約口へ送り、承認待ちも伝える', async () => { mocks.bookingWaitlists.mockResolvedValue({ waitlist: [offer] }); mocks.acceptWaitlist.mockResolvedValue({ booking_id: 'b', status: 'requested' }); render(<WaitlistOfferSheet id="w" onClose={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: 'この時間で予約する' })); expect(await screen.findByText('予約を受け付けました。お店の承認をお待ちください。')).toBeTruthy(); expect(mocks.acceptWaitlist).toHaveBeenCalledWith({ menu_id: 'm', staff_id: 's', starts_at: offer.starts_at, waitlist_id: 'w' }, expect.any(String)); });
  it('期限切れでは確定ボタンを出さない', async () => { mocks.bookingWaitlists.mockResolvedValue({ waitlist: [{ ...offer, hold_expires_at: '2020-01-01T00:00:00Z' }] }); render(<WaitlistOfferSheet id="w" onClose={vi.fn()} />); expect(await screen.findByText('この待ちは終わりました。仮押さえはありません。')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'この時間で予約する' })).toBeNull(); });
  it('席の見送りは本人用の席取り消し口へ送る', async () => { mocks.seatWaitlists.mockResolvedValue({ waitlist: [{ ...offer, store_id: 'store', store_name: '試験店', guest_count: 2 }] }); mocks.cancelSeatWaitlist.mockResolvedValue({ status: 'cancelled' }); render(<WaitlistOfferSheet id="w" seat decline onClose={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: '今回は見送る' })); expect(await screen.findByText('取り消しました。次の方へ案内します。')).toBeTruthy(); expect(mocks.cancelSeatWaitlist).toHaveBeenCalledWith('w'); });
  it('お支払いが必要なら既存のお支払いの動きにつなぐ', async () => { mocks.bookingWaitlists.mockResolvedValue({ waitlist: [offer] }); mocks.acceptWaitlist.mockResolvedValue({ booking_id: 'b', status: 'requested', payment: { id: 'p', status: 'unpaid', holdUntil: null } }); render(<WaitlistOfferSheet id="w" onClose={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: 'この時間で予約する' })); expect(await screen.findByText('お支払い')).toBeTruthy(); });
});
