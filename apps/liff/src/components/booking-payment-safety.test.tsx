// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BookingPayment from './booking-payment.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { bookingPaymentStatus: vi.fn(), startBookingPayment: vi.fn() } }));
const openWindow = vi.hoisted(() => vi.fn());
vi.mock('@line/liff', () => ({ default: { openWindow, closeWindow: vi.fn() } }));
beforeEach(() => {
  vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment: { id: 'p', status: 'unpaid', amount: 1000 } });
  vi.mocked(api.startBookingPayment).mockReset(); openWindow.mockClear();
});
afterEach(cleanup);
const mount = () => render(<BookingPayment bookingId="b" menuName="面談" initialAmount={1000} slot={{ date: '2099-01-01', start: '10:00' }} durationMinutes={60} />);

it('SELL-02: 試験の前後で準備中と実際の請求が無いことを示す', async () => {
  vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment: { id: 'p', status: 'paid' } });
  mount();
  expect(await screen.findByText('試験のお支払いを確認しました')).toBeTruthy();
  expect(screen.getByText('カード決済は準備中です')).toBeTruthy();
  expect(screen.getByText(/実際の請求・返金は行われません/)).toBeTruthy();
  expect(screen.queryByText('ご予約は確定です。当日お待ちしています。')).toBeNull();
});
it('A07: 結果不明は成功・未払いへ変換せず、再開始を出さない', async () => {
  vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment: { id: 'p', status: 'pending' }, operation_status: 'unknown', action_required: true });
  mount();
  expect(await screen.findByText(/もう一度支払わず/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /試験へ進む/ })).toBeNull();
  expect(api.startBookingPayment).not.toHaveBeenCalled(); expect(openWindow).not.toHaveBeenCalled();
});
it('開始後の切断は新しい開始を勧めず、確かめる案内へ', async () => {
  vi.mocked(api.startBookingPayment).mockRejectedValue(new Error('disconnected'));
  mount();
  const start = await screen.findByRole('button', { name: /試験へ進む/ });
  await vi.waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  expect(await screen.findByText(/もう一度支払わず/)).toBeTruthy();
  expect(api.startBookingPayment).toHaveBeenCalledTimes(1); expect(openWindow).not.toHaveBeenCalled();
});
it('失敗の記録を、予約取消や請求なしの確定へ読み替えない', async () => {
  vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment: { id: 'p', status: 'failed' } });
  mount();
  expect(await screen.findByText(/もう一度支払わず/)).toBeTruthy();
  expect(screen.queryByText(/仮押さえの期限が切れたため/)).toBeNull();
});
