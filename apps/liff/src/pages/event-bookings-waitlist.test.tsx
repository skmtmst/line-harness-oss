// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import EventBookings from './event-bookings.js';

const calls = vi.hoisted(() => ({ read: vi.fn(), leave: vi.fn(), cancelBooking: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { myEventBookings: calls.read, cancelMyEventWaitlist: calls.leave, cancelMyEventBooking: calls.cancelBooking } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
vi.mock('../lib/user-message.js', async load => ({ ...await load<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const waiting = { id: 'w1', source: 'waitlist', status: 'waitlisted', queue_position: 2, event_id: 'e1', event_name: '撮影会', slot_starts_at: '2099-10-20T10:00:00Z', slot_ends_at: '2099-10-20T11:00:00Z' };
beforeEach(() => {
  calls.read.mockResolvedValue({ items: [waiting] });
  calls.leave.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function open() { render(<MemoryRouter><EventBookings /></MemoryRouter>); }

it('待ちの順番を表示し、確認で閉じれば待ちを取り消さない', async () => {
  open();
  expect(await screen.findByText('キャンセル待ち 2番目')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル待ちをやめる' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/LINEのお知らせは届かなくなります/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
  expect(calls.leave).not.toHaveBeenCalled();
  expect(calls.cancelBooking).not.toHaveBeenCalled();
});
it('待ちのIDだけを待ちのAPIへ送って一覧を読み直す', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'キャンセル待ちをやめる' }));
  calls.read.mockResolvedValue({ items: [] });
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセル待ちをやめる' }));
  expect(await screen.findByText('これからのイベントはありません')).toBeTruthy();
  expect(calls.leave).toHaveBeenCalledWith('w1');
  expect(calls.cancelBooking).not.toHaveBeenCalled();
});
it('失敗した待ちは残し、未取得の順番を0番目へ替えない', async () => {
  calls.read.mockResolvedValue({ items: [{ ...waiting, queue_position: null }] });
  calls.leave.mockRejectedValue(new Error('通信失敗'));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'キャンセル待ちをやめる' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセル待ちをやめる' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('撮影会')).toBeTruthy();
  expect(screen.queryByText(/0番目/)).toBeNull();
  expect(calls.cancelBooking).not.toHaveBeenCalled();
});
