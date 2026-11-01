// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import EventBookings from './event-bookings.js';
import { api, type EventBookingMine } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { myEventBookings: vi.fn(), cancelMyEventBooking: vi.fn(), cancelMyEventWaitlist: vi.fn() } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
vi.mock('../lib/user-message.js', async load => ({ ...await load<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const booking = (over: Partial<EventBookingMine> = {}): EventBookingMine => ({ id: 'b1', event_id: 'e1', status: 'confirmed', customer_note: null, event_name: '見本のクラス', event_image_url: null, venue_name: '見本の教室', venue_url: null, cancel_deadline_hours_before: 48, slot_starts_at: '2099-06-04T01:00:00Z', slot_ends_at: '2099-06-04T02:00:00Z', ...over });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2099-06-01T01:00:00Z'));
  vi.mocked(api.myEventBookings).mockResolvedValue({ items: [booking()] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
const mount = () => render(<MemoryRouter initialEntries={['/events/me?liffId=store&from=profile']}><EventBookings /></MemoryRouter>);
it.each([[48, '開始48時間前'], [24, '開始24時間前'], [0, '開始時刻']] as const)('設定%s時間の確認文は実際の期限を示し、閉じても送信しない', async (hours, label) => {
  vi.mocked(api.myEventBookings).mockResolvedValue({ items: [booking({ cancel_deadline_hours_before: hours })] });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'キャンセルする' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(new RegExp(`${label}になると`))).toBeTruthy();
  expect(within(dialog).queryByText(/前日を過ぎる/)).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
  expect(api.cancelMyEventBooking).not.toHaveBeenCalled();
  expect(api.cancelMyEventWaitlist).not.toHaveBeenCalled();
});
it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])('期限%sでは従来の可否に従って取消操作を出さない', async (hours) => {
  vi.mocked(api.myEventBookings).mockResolvedValue({ items: [booking({ cancel_deadline_hours_before: hours })] });
  mount(); await screen.findByText('見本のクラス');
  expect(screen.queryByRole('button', { name: 'キャンセルする' })).toBeNull();
  expect(api.cancelMyEventBooking).not.toHaveBeenCalled();
});
it('不正な負の値を時間として断定せず、既存の可否は変更しない', async () => {
  vi.mocked(api.myEventBookings).mockResolvedValue({ items: [booking({ cancel_deadline_hours_before: -1 })] });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'キャンセルする' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/キャンセル期限になると/)).toBeTruthy();
  expect(within(dialog).queryByText(/開始-1時間前/)).toBeNull();
});
it.each([-1, 0, 1])('期限境界の%sミリ秒後でも既存の可否を保つ', async (offset) => {
  vi.setSystemTime(new Date(Date.parse(booking().slot_starts_at) - 48 * 3600_000 + offset));
  mount(); await screen.findByText('見本のクラス');
  expect(Boolean(screen.queryByRole('button', { name: 'キャンセルする' }))).toBe(offset < 0);
  expect(api.cancelMyEventBooking).not.toHaveBeenCalled();
});
it('待ちの解除は時間数を案内せず、既存の別文を出す', async () => {
  vi.mocked(api.myEventBookings).mockResolvedValue({ items: [booking({ source: 'waitlist', status: 'waitlisted' })] });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'キャンセル待ちをやめる' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText('キャンセル待ちをやめると、空きが出てもLINEのお知らせは届かなくなります。')).toBeTruthy();
  expect(within(dialog).queryByText(/48時間前/)).toBeNull();
});
it('期限切れの送信失敗でも同じIDだけを送り、予約を消さない', async () => {
  vi.mocked(api.cancelMyEventBooking).mockRejectedValue({ body: { error: 'cancel_deadline_passed' } });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'キャンセルする' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセルする' }));
  expect(await screen.findByText('キャンセル期限を過ぎています。')).toBeTruthy();
  expect(screen.getByText('見本のクラス')).toBeTruthy();
  expect(api.cancelMyEventBooking).toHaveBeenCalledExactlyOnceWith('b1');
  expect(api.cancelMyEventWaitlist).not.toHaveBeenCalled();
});
it('一覧取得の失敗では期限を推測せず再読込を出す', async () => {
  vi.mocked(api.myEventBookings).mockRejectedValueOnce(new Error('offline'));
  mount(); expect(await screen.findByRole('button', { name: 'もう一度読み込む' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'キャンセルする' })).toBeNull();
  expect(screen.queryByText(/48時間前/)).toBeNull();
});
