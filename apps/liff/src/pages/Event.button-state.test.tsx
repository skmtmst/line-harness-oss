// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Event from './Event.js';
import type { EventDetail, EventSlot, EventBookingMine } from '../lib/api.js';

/**
 * m11d: イベント詳細の下の主ボタンは状態に合わせる。
 * - 予約上限に達している時 →「予約上限に達しています」(押せない)
 * - 全部の時間が満席の時 →「満席です」(押せない。
 *   キャンセル待ちを受けるイベントでは満席の枠を選んで
 *   「キャンセル待ちに入る」を押せる)
 * - 選べる枠がある時 → 選ぶ前は「時間を選んでください」、
 *   選んだら「この時間で申し込む」
 */

vi.mock('../lib/api.js', () => ({
  api: {
    getEvent: vi.fn(),
    getEventSlots: vi.fn(),
    myEventBookings: vi.fn(),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    // 予約の画面の包み (LiffLookScope) が読む。見た目は既定のまま。
    bookingSettings: vi.fn().mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 }),
  },
}));

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
const getEvent = vi.mocked(api.getEvent);
const getEventSlots = vi.mocked(api.getEventSlots);
const myEventBookings = vi.mocked(api.myEventBookings);

function eventDetail(over: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 'e1',
    name: '秋の交流会',
    venue_name: '公民館',
    venue_url: null,
    image_url: null,
    description: null,
    description_centered: 0,
    max_bookings_per_friend: 2,
    requires_approval: 0,
    cancel_deadline_hours_before: null,
    waitlist_enabled: 0,
    ...over,
  };
}

function slot(over: Partial<EventSlot> = {}): EventSlot {
  return {
    id: 's1',
    event_id: 'e1',
    starts_at: '2026-10-20T01:00:00.000Z',
    ends_at: '2026-10-20T02:00:00.000Z',
    capacity: 10,
    is_active: 1,
    active_count: 0,
    remaining: 5,
    ...over,
  };
}

function mine(over: Partial<EventBookingMine> = {}): EventBookingMine {
  return {
    id: 'b1',
    event_id: 'e1',
    status: 'confirmed',
    customer_note: null,
    event_name: '秋の交流会',
    event_image_url: null,
    venue_name: null,
    venue_url: null,
    cancel_deadline_hours_before: null,
    slot_starts_at: '2026-10-20T01:00:00.000Z',
    slot_ends_at: '2026-10-20T02:00:00.000Z',
    ...over,
  };
}

function setup(detail: EventDetail, slots: EventSlot[], bookings: EventBookingMine[]) {
  getEvent.mockResolvedValue(detail);
  getEventSlots.mockResolvedValue({ items: slots });
  myEventBookings.mockImplementation(async (tab: 'upcoming' | 'past') =>
    tab === 'upcoming' ? { items: bookings } : { items: [] },
  );
  render(
    <MemoryRouter initialEntries={['/events/e1?liffId=test']}>
      <Routes>
        <Route path="/events/:id" element={<Event />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('上限に達している時', () => {
  it('主ボタンは「予約上限に達しています」で押せない', async () => {
    setup(
      eventDetail({ max_bookings_per_friend: 1 }),
      [slot({ id: 's1' }), slot({ id: 's2', starts_at: '2026-10-20T03:00:00.000Z', ends_at: '2026-10-20T04:00:00.000Z' })],
      [mine()],
    );
    const button = await screen.findByRole('button', { name: '予約上限に達しています' });
    expect(button.hasAttribute('disabled')).toBe(true);
    // 枠はどれも選べない。
    const slotButton = screen.getByRole('button', { name: '10/20(火) 10:00〜11:00 残り 5' });
    expect(slotButton.hasAttribute('disabled')).toBe(true);
  });
});

describe('全部の時間が満席の時', () => {
  it('待ちを受けないイベントは主ボタンが「満席です」で押せない', async () => {
    setup(
      eventDetail({ waitlist_enabled: 0 }),
      [slot({ id: 's1', remaining: 0 }), slot({ id: 's2', remaining: 0 })],
      [],
    );
    const button = await screen.findByRole('button', { name: '満席です' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('待ちを受けるイベントは満席の枠を選んで「キャンセル待ちに入る」を押せる', async () => {
    setup(
      eventDetail({ waitlist_enabled: 1 }),
      [
        slot({ id: 's1', remaining: 0 }),
        slot({
          id: 's2',
          remaining: 0,
          starts_at: '2026-10-20T03:00:00.000Z',
          ends_at: '2026-10-20T04:00:00.000Z',
        }),
      ],
      [],
    );
    // 選ぶ前は満席の理由だけ出し、待ちには進めない。
    const before = await screen.findByRole('button', { name: '満席です' });
    expect(before.hasAttribute('disabled')).toBe(true);
    // 満席でも待ちがあれば枠は選べる。
    fireEvent.click(screen.getByRole('button', { name: '10/20(火) 10:00〜11:00 満席' }));
    const after = await screen.findByRole('button', { name: 'キャンセル待ちに入る' });
    expect(after.hasAttribute('disabled')).toBe(false);
  });
});

describe('選べる枠がある時', () => {
  it('選ぶ前は「時間を選んでください」、選んだら「この時間で申し込む」', async () => {
    setup(eventDetail(), [slot({ id: 's1' }), slot({ id: 's2', remaining: 0 })], []);
    const before = await screen.findByRole('button', { name: '時間を選んでください' });
    expect(before.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '10/20(火) 10:00〜11:00 残り 5' }));
    const after = await screen.findByRole('button', { name: 'この時間で申し込む' });
    expect(after.hasAttribute('disabled')).toBe(false);
  });
});
