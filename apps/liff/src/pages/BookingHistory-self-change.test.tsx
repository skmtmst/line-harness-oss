// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BookingHistory from './BookingHistory.js';
import type { BookingHistoryItem } from '../lib/api.js';

/**
 * F-6 予約の履歴（YvTJ3）：カードの「日時を変える」「キャンセル」。
 * - 履歴の口が版（lock_version）を返した予約にだけ出す（無いと送れない）
 * - キャンセルは確認してから、版を添えて送り、一覧を読み直す
 * - 日時を変えるは空きから選び、選んだ日時（UTC）と版を添えて送る
 * - 期限切れは人の言葉で出す
 */

vi.mock('../lib/api.js', () => ({
  api: {
    me: vi.fn(),
    cancelMyBooking: vi.fn(),
    rescheduleMyBooking: vi.fn(),
    availability: vi.fn(),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    bookingSettings: vi.fn().mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 }),
  },
}));

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
const me = vi.mocked(api.me);
const cancelMyBooking = vi.mocked(api.cancelMyBooking);
const rescheduleMyBooking = vi.mocked(api.rescheduleMyBooking);
const availability = vi.mocked(api.availability);

function item(over: Partial<BookingHistoryItem> = {}): BookingHistoryItem {
  return {
    id: 'bk-1',
    starts_at: '2099-10-02T04:00:00.000Z',
    status: 'confirmed',
    menu_name: 'トリミング（小型犬）',
    staff_name: '河野',
    profile_image_url: null,
    lock_version: 4,
    menu_id: 'menu-1',
    staff_id: 'staff-1',
    ...over,
  };
}

function setup(upcoming: BookingHistoryItem[]) {
  me.mockResolvedValue({ upcoming, past: [] });
  render(
    <MemoryRouter initialEntries={['/booking/history?liffId=test']}>
      <BookingHistory />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  me.mockReset();
  cancelMyBooking.mockReset();
  rescheduleMyBooking.mockReset();
  availability.mockReset();
});
afterEach(() => cleanup());

describe('予約の履歴：本人の日時変更・キャンセル（F-6）', () => {
  it('版を返さない予約には「日時を変える」「キャンセル」を出さず、トークでの連絡を案内する', async () => {
    setup([item({ lock_version: undefined })]);
    await screen.findByText('トリミング（小型犬）');
    expect(screen.queryByRole('button', { name: 'キャンセル' })).toBeNull();
    expect(screen.queryByRole('button', { name: '日時を変える' })).toBeNull();
    expect(screen.getByText('予定の変更・キャンセルは、お店に LINE でご連絡ください。')).toBeTruthy();
  });

  it('キャンセルは確認してから版を添えて送り、一覧を読み直す', async () => {
    cancelMyBooking.mockResolvedValue({ lock_version: 5, status: 'cancelled' });
    setup([item()]);
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }));
    expect(await screen.findByText(/トリミング（小型犬）をキャンセルしますか/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセルする' }));
    await vi.waitFor(() => expect(cancelMyBooking).toHaveBeenCalledWith('bk-1', 4));
    await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(2));
  });

  it('期限を過ぎたキャンセルは、人の言葉で出す', async () => {
    cancelMyBooking.mockRejectedValue(Object.assign(new Error('API 403'), { status: 403, body: { error: 'self_deadline_passed' } }));
    setup([item()]);
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }));
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセルする' }));
    expect(await screen.findByText('キャンセルの期限を過ぎています。トークでご連絡ください。')).toBeTruthy();
  });

  it('日時を変えるは空きから選び、選んだ日時（UTC）と版を添えて送る', async () => {
    availability.mockResolvedValue({
      by_staff: [{
        staff_id: 'staff-1',
        display_name: '河野',
        slots: [
          { date: '2099-10-05', start: '10:00', end: '11:00', remaining: 0 },
          { date: '2099-10-06', start: '14:00', end: '15:00', remaining: 2 },
        ],
      }],
    });
    rescheduleMyBooking.mockResolvedValue({ lock_version: 5, status: 'confirmed' });
    setup([item()]);
    fireEvent.click(await screen.findByRole('button', { name: '日時を変える' }));
    await vi.waitFor(() => expect(availability).toHaveBeenCalled());
    expect(availability.mock.calls[0][0]).toBe('menu-1');
    expect(availability.mock.calls[0][1]).toBe('staff-1');
    // 埋まった枠は並べない。
    expect(screen.queryByText(/10\/5/)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /10\/6（火） 14:00/ }));
    fireEvent.click(screen.getByRole('button', { name: 'この日時に変える' }));
    await vi.waitFor(() =>
      expect(rescheduleMyBooking).toHaveBeenCalledWith('bk-1', { starts_at: '2099-10-06T05:00:00.000Z', lock_version: 4 }),
    );
  });
});
