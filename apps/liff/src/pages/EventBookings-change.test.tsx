// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EventBookings from './EventBookings.js';
import type { EventBookingMine, EventSlot } from '../lib/api.js';

/**
 * U-3: 自分の申込の開催回変更。
 * - 「時間を変える」から時間を選んで変える
 * - 新しい席が取れたときだけ今の予約を取り消す (API の約束。画面は結果で分岐しない)
 * - 満席のときは人の言葉で出す
 * - 失敗後の再試行は同じ冪等鍵を使い回す
 */

vi.mock('../lib/api.js', () => ({
  api: {
    myEventBookings: vi.fn(),
    cancelMyEventBooking: vi.fn(),
    getEventSlots: vi.fn(),
    changeMyEventBooking: vi.fn(),
  },
}));

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
const myEventBookings = vi.mocked(api.myEventBookings);
const getEventSlots = vi.mocked(api.getEventSlots);
const changeMyEventBooking = vi.mocked(api.changeMyEventBooking);

function booking(over: Partial<EventBookingMine> = {}): EventBookingMine {
  return {
    id: 'b1',
    event_id: 'e1',
    status: 'confirmed',
    customer_note: null,
    event_name: '秋の交流会',
    event_image_url: null,
    venue_name: '公民館',
    venue_url: null,
    cancel_deadline_hours_before: 24,
    slot_starts_at: '2099-06-01T01:00:00.000Z',
    slot_ends_at: '2099-06-01T02:00:00.000Z',
    ...over,
  };
}

function slot(over: Partial<EventSlot> = {}): EventSlot {
  return {
    id: 's1',
    event_id: 'e1',
    starts_at: '2099-06-01T01:00:00.000Z',
    ends_at: '2099-06-01T02:00:00.000Z',
    capacity: 10,
    is_active: 1,
    active_count: 0,
    remaining: 5,
    ...over,
  };
}

function setup(bookings: EventBookingMine[], slots: EventSlot[]) {
  myEventBookings.mockImplementation(async (tab: 'upcoming' | 'past') =>
    tab === 'upcoming' ? { items: bookings } : { items: [] },
  );
  getEventSlots.mockResolvedValue({ items: slots });
  render(<EventBookings />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('U-3 開催回の変更', () => {
  it('時間を選んで変えると changeMyEventBooking を送る', async () => {
    changeMyEventBooking.mockResolvedValue({ id: 'b2', status: 'confirmed' });
    setup(
      [booking()],
      [
        slot({ id: 's1' }),
        slot({ id: 's2', starts_at: '2099-06-08T01:00:00.000Z', ends_at: '2099-06-08T02:00:00.000Z' }),
      ],
    );
    fireEvent.click(await screen.findByRole('button', { name: /時間を変える/ }));
    // 今の時間は選べない。
    expect(await screen.findByRole('button', { name: /今の時間/ })).toHaveProperty('disabled', true);
    fireEvent.click(await screen.findByRole('button', { name: /空きあり/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'この時間に変える' }));
    expect(changeMyEventBooking).toHaveBeenCalledTimes(1);
    expect(changeMyEventBooking).toHaveBeenCalledWith('b1', 's2', expect.any(String));
  });

  it('満席のときは人の言葉で出す', async () => {
    changeMyEventBooking.mockRejectedValue({ body: { error: 'slot_full' } });
    setup(
      [booking()],
      [
        slot({ id: 's1' }),
        slot({ id: 's2', starts_at: '2099-06-08T01:00:00.000Z', ends_at: '2099-06-08T02:00:00.000Z' }),
      ],
    );
    fireEvent.click(await screen.findByRole('button', { name: /時間を変える/ }));
    fireEvent.click(await screen.findByRole('button', { name: /空きあり/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'この時間に変える' }));
    expect(await screen.findByText('選んだ時間は満席になりました。別の時間を選んでください。')).toBeDefined();
    expect(changeMyEventBooking).toHaveBeenCalledTimes(1);
  });

  it('失敗後の再試行は同じ冪等鍵を使い回す', async () => {
    changeMyEventBooking.mockRejectedValueOnce({ body: { error: 'slot_full' } });
    changeMyEventBooking.mockResolvedValueOnce({ id: 'b2', status: 'confirmed' });
    setup(
      [booking()],
      [
        slot({ id: 's1' }),
        slot({ id: 's2', starts_at: '2099-06-08T01:00:00.000Z', ends_at: '2099-06-08T02:00:00.000Z' }),
      ],
    );
    fireEvent.click(await screen.findByRole('button', { name: /時間を変える/ }));
    fireEvent.click(await screen.findByRole('button', { name: /空きあり/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'この時間に変える' }));
    expect(await screen.findByText('選んだ時間は満席になりました。別の時間を選んでください。')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'この時間に変える' }));
    expect(changeMyEventBooking).toHaveBeenCalledTimes(2);
    const firstKey = changeMyEventBooking.mock.calls[0]?.[2];
    const secondKey = changeMyEventBooking.mock.calls[1]?.[2];
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });
});
