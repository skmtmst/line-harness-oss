// @vitest-environment happy-dom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WaitlistOfferSheet from './waitlist-offer-sheet.js';

const mocks = vi.hoisted(() => ({ bookingWaitlists: vi.fn(), acceptWaitlist: vi.fn(), bookingPaymentStatus: vi.fn(), startBookingPayment: vi.fn(), cancelWaitlist: vi.fn(), cancelSeatWaitlist: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: mocks }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn(), openWindow: vi.fn() } }));
const entry = { id: 'w', staff_id: 's', menu_id: 'm', starts_at: '2099-01-01T03:00:00Z', ends_at: '2099-01-01T04:00:00Z', status: 'invited', hold_expires_at: '2099-01-01T02:00:00Z', hold_minutes: 30, created_at: '2026-11-01', menu_name: '見本の施術', staff_name: '担当' };
beforeEach(() => { vi.resetAllMocks(); mocks.bookingWaitlists.mockResolvedValue({ waitlist: [entry] }); mocks.acceptWaitlist.mockResolvedValue({ booking_id: 'b', status: 'requested', payment: { id: 'p', status: 'unpaid' } }); mocks.bookingPaymentStatus.mockResolvedValue({ payment: { id: 'p', status: 'unpaid', amount: 8400 } }); });
afterEach(cleanup);

it('支払い中の明示Closeは帯内1つで、窓だけを閉じる', async () => {
  const close = vi.fn(); function Host() { const [open, setOpen] = useState(true); return open ? <WaitlistOfferSheet id="w" onClose={() => { close(); setOpen(false); }} /> : <p>通常画面</p>; }
  render(<Host />); fireEvent.click(await screen.findByRole('button', { name: 'この枠で予約する' })); await screen.findByText('お支払いの確認');
  const dialog = screen.getByRole('dialog'); const bar = within(dialog.querySelector('[data-liff-bottom-bar]') as HTMLElement);
  expect(bar.getAllByRole('button', { name: '閉じる' })).toHaveLength(1); expect(within(dialog).getAllByRole('button', { name: '閉じる' })).toHaveLength(2);
  expect(within(dialog).getAllByRole('heading')).toHaveLength(1); expect(within(dialog).queryByRole('heading', { name: '空きが出ました' })).toBeNull();
  fireEvent.click(bar.getByRole('button', { name: '閉じる' })); await screen.findByText('通常画面'); expect(close).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.startBookingPayment).not.toHaveBeenCalled(); expect(mocks.cancelWaitlist).not.toHaveBeenCalled(); expect(mocks.cancelSeatWaitlist).not.toHaveBeenCalled();
  expect(mocks.acceptWaitlist).toHaveBeenCalledExactlyOnceWith({ menu_id: 'm', staff_id: 's', starts_at: entry.starts_at, waitlist_id: 'w' }, expect.stringMatching(/^[\da-f-]{36}$/));
});

it('支払いの初回読取中でも背景から窓を閉じられる', async () => {
  mocks.bookingPaymentStatus.mockReturnValue(new Promise(() => {})); const close = vi.fn(); render(<WaitlistOfferSheet id="w" onClose={close} />);
  fireEvent.click(await screen.findByRole('button', { name: 'この枠で予約する' })); await screen.findByText('お支払いの確認');
  fireEvent.click(screen.getByRole('dialog').querySelector('button[aria-label="閉じる"]')!);
  expect(close).toHaveBeenCalledTimes(1); expect(mocks.startBookingPayment).not.toHaveBeenCalled(); expect(mocks.cancelWaitlist).not.toHaveBeenCalled();
});

it('支払いがない受付は従来の完了と末尾Closeを保持する', async () => {
  mocks.acceptWaitlist.mockResolvedValue({ booking_id: 'b', status: 'confirmed' }); const close = vi.fn(); render(<WaitlistOfferSheet id="w" onClose={close} />);
  const accept = await screen.findByRole('button', { name: 'この枠で予約する' }); act(() => { fireEvent.click(accept); fireEvent.click(accept); }); await screen.findByText('予約が確定しました。');
  expect(screen.getByRole('heading', { name: '手続きが完了しました' })).toBeTruthy(); expect(document.querySelector('[data-liff-bottom-bar]')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: '閉じる' }).at(-1)!); expect(close).toHaveBeenCalledTimes(1); expect(mocks.acceptWaitlist).toHaveBeenCalledTimes(1);
});
