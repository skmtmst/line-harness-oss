// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BookingPayment from './booking-payment.js';
import { api } from '../lib/api.js';
import { PAYMENT_UNKNOWN } from '../lib/customer-words.js';

const sdk = vi.hoisted(() => ({ openWindow: vi.fn(), closeWindow: vi.fn() }));
vi.mock('@line/liff', () => ({ default: sdk }));
vi.mock('../lib/api.js', () => ({ api: { bookingPaymentStatus: vi.fn(), startBookingPayment: vi.fn() } }));
const props = { bookingId: 'b', menuName: '見本の施術', initialAmount: 8400, slot: { date: '2099-01-01', start: '10:00' }, durationMinutes: 60 };
const payment = { id: 'p', status: 'unpaid' as const, amount: 8400, hold_until: '2099-01-01T02:00:00Z' };
const bar = () => within(document.querySelector('[data-liff-bottom-bar]') as HTMLElement);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment }); vi.mocked(api.startBookingPayment).mockResolvedValue({ payment, checkoutUrl: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['unpaid', 'waiting', 'paid', 'expired', 'failed'] as const)('%sの帯内で窓だけを閉じる', async status => {
  vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment: { ...payment, status: status === 'waiting' ? 'unpaid' : status } });
  const close = vi.fn(); render(<BookingPayment {...props} onClose={close} />);
  if (status === 'waiting') { const start = await screen.findByRole('button', { name: /試験へ進む/ }); await vi.waitFor(() => expect(start).toHaveProperty('disabled', false)); fireEvent.click(start); await screen.findByText('お支払い待ちです'); }
  else await screen.findByText(status === 'paid' ? '試験のお支払いを確認しました' : status === 'expired' ? 'お支払いが終わりませんでした' : status === 'failed' ? PAYMENT_UNKNOWN : 'お支払いの確認');
  const before = vi.mocked(api.startBookingPayment).mock.calls.length;
  expect(document.querySelectorAll('[data-liff-bottom-bar]')).toHaveLength(1);
  expect(bar().getAllByRole('button', { name: '閉じる' })).toHaveLength(1);
  fireEvent.click(bar().getByRole('button', { name: '閉じる' }));
  expect(close).toHaveBeenCalledTimes(1); expect(sdk.closeWindow).not.toHaveBeenCalled(); expect(api.startBookingPayment).toHaveBeenCalledTimes(before);
});

it.each(['loading', 'failure'] as const)('初回取得%sでも開始せず窓を閉じる', async state => {
  vi.mocked(api.bookingPaymentStatus).mockImplementation(() => state === 'loading' ? new Promise(() => {}) : Promise.reject(new Error('offline')));
  const close = vi.fn(); render(<BookingPayment {...props} onClose={close} />);
  if (state === 'failure') await screen.findByText(PAYMENT_UNKNOWN);
  else expect(bar().getByRole('button', { name: /試験へ進む/ })).toHaveProperty('disabled', true);
  fireEvent.click(bar().getByRole('button', { name: '閉じる' }));
  expect(close).toHaveBeenCalledTimes(1); expect(api.startBookingPayment).not.toHaveBeenCalled(); expect(sdk.openWindow).not.toHaveBeenCalled();
});

it('通常callerに通知口が無ければ既存主操作だけを出す', async () => {
  render(<BookingPayment {...props} />); const start = await screen.findByRole('button', { name: /試験へ進む/ });
  await vi.waitFor(() => expect(start).toHaveProperty('disabled', false));
  expect(bar().queryByRole('button', { name: '閉じる' })).toBeNull(); expect(bar().getAllByRole('button')).toHaveLength(1);
  fireEvent.click(start); await screen.findByText('お支払い待ちです');
  expect(api.startBookingPayment).toHaveBeenCalledExactlyOnceWith('b'); expect(bar().queryByRole('button', { name: '閉じる' })).toBeNull();
});

it('LINEへ戻る操作と窓だけを閉じる操作を分ける', async () => {
  vi.mocked(api.bookingPaymentStatus).mockResolvedValue({ payment: { ...payment, status: 'paid' } });
  const close = vi.fn(); render(<BookingPayment {...props} onClose={close} />); await screen.findByText('試験のお支払いを確認しました');
  fireEvent.click(bar().getByRole('button', { name: 'LINEに戻る' })); expect(sdk.closeWindow).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
  fireEvent.click(bar().getByRole('button', { name: '閉じる' })); expect(close).toHaveBeenCalledTimes(1); expect(sdk.closeWindow).toHaveBeenCalledTimes(1);
});

it.each(['success', 'failure'] as const)('開始中に閉じた後の遅い%sで外を開かず、再開始しない', async outcome => {
  const startResult = deferred<Awaited<ReturnType<typeof api.startBookingPayment>>>(); vi.mocked(api.startBookingPayment).mockReturnValue(startResult.promise);
  let remove = () => {}; const close = vi.fn(() => remove()); const view = render(<BookingPayment {...props} onClose={close} />); remove = view.unmount;
  const start = await screen.findByRole('button', { name: /試験へ進む/ }); await vi.waitFor(() => expect(start).toHaveProperty('disabled', false));
  act(() => { fireEvent.click(start); fireEvent.click(start); }); expect(api.startBookingPayment).toHaveBeenCalledExactlyOnceWith('b');
  expect(bar().getByRole('button', { name: '閉じる' })).toHaveProperty('disabled', false); fireEvent.click(bar().getByRole('button', { name: '閉じる' }));
  await act(async () => { if (outcome === 'success') startResult.resolve({ payment, checkoutUrl: 'https://checkout.stripe.com/test_local' }); else startResult.reject(new Error('offline')); });
  expect(close).toHaveBeenCalledTimes(1); expect(sdk.openWindow).not.toHaveBeenCalled(); expect(api.startBookingPayment).toHaveBeenCalledTimes(1);
});

it('窓を閉じて待機pollを解除し、進行中の旧読取も持ち越さない', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let remove = () => {}; await act(async () => { const view = render(<BookingPayment {...props} onClose={() => remove()} />); remove = view.unmount; });
  await act(async () => { fireEvent.click(bar().getByRole('button', { name: /試験へ進む/ })); }); expect(screen.getByText('お支払い待ちです')).toBeTruthy();
  const pending = deferred<Awaited<ReturnType<typeof api.bookingPaymentStatus>>>(); vi.mocked(api.bookingPaymentStatus).mockReturnValue(pending.promise);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); expect(api.bookingPaymentStatus).toHaveBeenCalledTimes(2);
  fireEvent.click(bar().getByRole('button', { name: '閉じる' })); const calls = vi.mocked(api.bookingPaymentStatus).mock.calls.length;
  await act(async () => { pending.resolve({ payment: { ...payment, status: 'paid' } }); await vi.advanceTimersByTimeAsync(15000); });
  expect(document.querySelector('[data-liff-bottom-bar]')).toBeNull(); expect(api.bookingPaymentStatus).toHaveBeenCalledTimes(calls); expect(sdk.openWindow).not.toHaveBeenCalled();
});
