// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BookingHistory from './booking-history.js';
import type { BookingHistoryItem } from '../lib/api.js';

/*
 * 予約の履歴のお支払い（・nWby5・hOILq）：
 * 未払いは札・払う期限・［お支払いへ進む］、払い済みのキャンセルは全額返金を先に知らせる。札の言葉は共通の定義。
 */

vi.mock('../lib/api.js', () => ({
  api: {
    customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: { liff_theme: 'line' } } }),
    me: vi.fn(),
    cancelMyBooking: vi.fn(),
    rescheduleMyBooking: vi.fn(),
    availability: vi.fn(),
    bookingPaymentStatus: vi.fn(),
    menus: vi.fn().mockResolvedValue({ menus: [] }),
    startBookingPayment: vi.fn(),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    bookingSettings: vi.fn().mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 }),
  },
}));
const openWindow = vi.hoisted(() => vi.fn());
vi.mock('@line/liff', () => ({ default: { openWindow } }));
vi.mock('../lib/user-message.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/user-message.js')>()), logFailure: vi.fn() }));

const { api } = await import('../lib/api.js');

const item = (over: Partial<BookingHistoryItem>): BookingHistoryItem => ({
  id: 'bk-1', starts_at: '2099-10-25T02:00:00.000Z', status: 'requested', menu_name: 'カット', staff_name: '佐々木',
  profile_image_url: null, lock_version: 1, menu_id: 'm1', staff_id: 's1', ...over,
});

beforeEach(() => {
  vi.mocked(api.me).mockResolvedValue({ upcoming: [item({ id: 'unpaid' }), item({ id: 'paid', menu_name: 'カット＋カラー', status: 'confirmed' })], past: [] });
  vi.mocked(api.bookingPaymentStatus).mockImplementation(async (id: string) => ({
    payment: id === 'unpaid'
      ? { id: 'p1', status: 'unpaid', amount: 4400, hold_until: '2099-10-24T09:00:00.000Z' }
      : { id: 'p2', status: 'paid', amount: 8800 },
  }));
  vi.mocked(api.startBookingPayment).mockResolvedValue({ payment: null, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const render2 = () => render(<MemoryRouter initialEntries={['/booking/history?liffId=test']}><BookingHistory /></MemoryRouter>);

it('未払いは共通の札と払う期限、［お支払いへ進む］で支払いのページへ', async () => {
  render2();
  expect(await screen.findByText('未払い ¥4,400')).toBeTruthy();
  expect(screen.getByText('支払い済み ¥8,800')).toBeTruthy();
  expect(screen.getByText(/までにお支払いください/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'お支払いへ進む' }));
  await vi.waitFor(() => expect(api.startBookingPayment).toHaveBeenCalledWith('unpaid'));
  await vi.waitFor(() => expect(openWindow).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/c/pay/cs_test_1', external: true }));
});

it('払い済みの予約をキャンセルするときは、全額返金を先に知らせる', async () => {
  render2();
  await screen.findByText('支払い済み ¥8,800');
  const cancels = screen.getAllByRole('button', { name: 'キャンセル' });
  fireEvent.click(cancels[cancels.length - 1]);
  expect(await screen.findByText('試験のお支払い ¥8,800 の全額返金を試験で記録します')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'キャンセルする（試験返金）' })).toBeTruthy();
});

it('領収書URLが無いときは外を開かず、準備中と連絡先を案内する', async () => {
  render2();
  fireEvent.click(await screen.findByRole('button', { name: '領収書を見る' }));
  expect(await screen.findByText(/領収書は現在準備中です/)).toBeTruthy();
  expect(openWindow).not.toHaveBeenCalled();
});

it('領収書URLがあるときだけ返されたページを開く', async () => {
  vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment: { id: 'p', status: 'paid', receipt_url: 'https://pay.stripe.com/receipt-fixture' } });
  render2();
  const receipts = await screen.findAllByRole('button', { name: '領収書を見る' });
  fireEvent.click(receipts[0]);
  expect(openWindow).toHaveBeenCalledWith({ url: 'https://pay.stripe.com/receipt-fixture', external: true });
});

it('A07: 開始結果が不明なら支払いボタンを出さず、問い合わせを案内する', async () => {
  vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment: { id: 'p', status: 'pending' }, operation_status: 'unknown', action_required: true });
  render2();
  expect((await screen.findAllByText(/もう一度支払わず/)).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'お支払いへ進む' })).toBeNull();
  expect(api.startBookingPayment).not.toHaveBeenCalled();
});
