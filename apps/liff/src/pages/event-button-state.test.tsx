// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Event from './event.js';
import type { EventDetail, EventSlot, EventBookingMine } from '../lib/api.js';

/**
 * m11d: イベント詳細の下の主ボタンは状態に合わせる。
 * - 予約上限に達している時 →「予約上限に達しています」(押せない)
 * - 全部の時間が満席の時 →「満席です」(押せない。
 *   キャンセル待ちを受けるイベントでは満席の枠を選んで
 *   「キャンセル待ちで申し込む」を押せる)
 * - 選べる枠がある時 → 選ぶ前は「時間を選んでください」、
 *   選んだら「この時間で申し込む」
 */

vi.mock('../lib/api.js', () => ({
  api: { customerLook: vi.fn().mockResolvedValue({success:true,data:{settings:{liff_theme:"line"}}}),
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
        <Route path="/events/:id/confirm" element={<p>申込の確認先</p>} />
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
    expect(screen.getByText('このイベントへの予約上限（1）に達しています。')).toBeTruthy();
    // 枠はどれも選べない。
    const slotButton = screen.getByRole('button', { name: '10:00〜11:00 残り 5' });
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

  it('待ちを受けるイベントは満席の枠を選んで「キャンセル待ちで申し込む」を押せる', async () => {
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
    const after = await screen.findByRole('button', { name: 'キャンセル待ちで申し込む' });
    expect(after.hasAttribute('disabled')).toBe(false);
  });
});

describe('選べる枠がある時', () => {
  it('選ぶ前は「時間を選んでください」、選んだら「この時間で申し込む」', async () => {
    setup(eventDetail(), [slot({ id: 's1' }), slot({ id: 's2', remaining: 0 })], []);
    const before = await screen.findByRole('button', { name: '時間を選んでください' });
    expect(before.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '10:00〜11:00 残り 5' }));
    const after = await screen.findByRole('button', { name: 'この時間で申し込む' });
    expect(after.hasAttribute('disabled')).toBe(false);
  });
});

it('会場の住所を表示する', async () => {
  getEvent.mockResolvedValue(eventDetail({ venue_address: 'テスト会場の住所' }));
  getEventSlots.mockResolvedValue({items:[slot()]});
  myEventBookings.mockResolvedValue({items:[]});
  render(<MemoryRouter initialEntries={['/events/e1']}><Routes><Route path="/events/:id" element={<Event />} />
        <Route path="/events/:id/confirm" element={<p>申込の確認先</p>} /></Routes></MemoryRouter>);
  expect(await screen.findByText('テスト会場の住所')).toBeTruthy();
});

it('イベント画像は名前を読み上げ、枠を選ぶだけでは移動せず、主操作で確認へ進む', async () => {
  setup(eventDetail({ image_url: 'https://example.test/event.png' }), [slot()], []);
  expect((await screen.findByRole('img', { name: '秋の交流会' })).getAttribute('src')).toBe('https://example.test/event.png');
  fireEvent.click(screen.getByRole('button', { name: '10:00〜11:00 残り 5' }));
  expect(screen.queryByText('申込の確認先')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'この時間で申し込む' }));
  expect(await screen.findByText('申込の確認先')).toBeTruthy();
});


describe('開催枠の取得状態を席の状態と区別する', () => {
  it.each([0, 1])('開催枠0件は満席や定員なしと表示しない（待ち=%s）', async waitlist_enabled => {
    setup(eventDetail({ waitlist_enabled }), [], []);
    const button = await screen.findByRole('button', { name: '予約可能な枠がありません' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('現在予約可能な枠はありません。')).toBeTruthy();
    expect(screen.queryByText('定員なし')).toBeNull();
    expect(screen.queryByRole('button', { name: '満席です' })).toBeNull();
    fireEvent.click(button);
    expect(screen.queryByText('申込の確認先')).toBeNull();
  });

  it('定員なしの開催枠がある場合は表示し、従来どおり選べる', async () => {
    setup(eventDetail(), [slot({ capacity: null, remaining: null })], []);
    await screen.findByRole('button', { name: '時間を選んでください' });
    expect(screen.getAllByText('定員なし')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '10:00〜11:00 定員なし' }));
    expect(screen.getByRole('button', { name: 'この時間で申し込む' }).hasAttribute('disabled')).toBe(false);
  });

  it('取得中と取得失敗では空枠や満席の表示を出さず、再試行で空枠を示す', async () => {
    let fail!: (reason: Error) => void;
    getEvent.mockResolvedValue(eventDetail());
    getEventSlots.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue({ items: [] });
    myEventBookings.mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/events/e1?liffId=test']}><Routes><Route path="/events/:id" element={<Event />} /></Routes></MemoryRouter>);
    expect(screen.queryByText('現在予約可能な枠はありません。')).toBeNull();
    expect(screen.queryByRole('button', { name: '満席です' })).toBeNull();
    fail(new Error('offline'));
    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' });
    expect(screen.queryByText('現在予約可能な枠はありません。')).toBeNull();
    expect(screen.queryByText('定員なし')).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: '予約可能な枠がありません' })).toBeTruthy();
  });
});

describe('定員のある時間と定員なしの時間が混在する時', () => {
  it('上部の残席は定員のある時間だけの合計と明記し、各時間の表示と確認先を保つ', async () => {
    setup(eventDetail(), [slot({ capacity: 5, remaining: 2 }), slot({ id: 'unlimited', capacity: null, remaining: null, starts_at: '2026-10-20T03:00:00.000Z', ends_at: '2026-10-20T04:00:00.000Z' })], []);
    expect(await screen.findByText('定員のある時間：残り 2 席（定員 5）・定員なしの時間もあります')).toBeTruthy();
    expect(screen.getByText('定員のある時間：残り 2 席（定員 5）・定員なしの時間もあります').classList.contains('font-bold')).toBe(true);
    expect(screen.queryByText('残り 2 席（定員 5）', { exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: '10:00〜11:00 残り 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '12:00〜13:00 定員なし' }));
    const next = screen.getByRole('button', { name: 'この時間で申し込む' });
    expect(next.hasAttribute('disabled')).toBe(false); fireEvent.click(next);
    expect(await screen.findByText('申込の確認先')).toBeTruthy();
  });

  it('定員のある時間が満席でも、定員なしの時間があることを隠さず選べる', async () => {
    setup(eventDetail(), [slot({ capacity: 5, remaining: 0 }), slot({ id: 'unlimited', capacity: null, remaining: null, starts_at: '2026-10-20T03:00:00.000Z', ends_at: '2026-10-20T04:00:00.000Z' })], []);
    expect(await screen.findByText('定員のある時間：残り 0 席（定員 5）・定員なしの時間もあります')).toBeTruthy();
    expect(screen.getByText('定員のある時間：残り 0 席（定員 5）・定員なしの時間もあります').classList.contains('font-bold')).toBe(false);
    expect(screen.getByRole('button', { name: '10/20(火) 10:00〜11:00 満席' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '12:00〜13:00 定員なし' }));
    expect(screen.getByRole('button', { name: 'この時間で申し込む' }).hasAttribute('disabled')).toBe(false);
  });

  it('一部の残席が未取得なら、残りを0や一部の合計で埋めない', async () => {
    setup(eventDetail(), [slot({ capacity: 5, remaining: 2 }), slot({ id: 'unknown', capacity: 7, remaining: null }), slot({ id: 'unlimited', capacity: null, remaining: null })], []);
    expect(await screen.findByText('定員のある時間：定員 12 席・残席は各時間で確認してください・定員なしの時間もあります')).toBeTruthy();
    expect(screen.getByText('定員のある時間：定員 12 席・残席は各時間で確認してください・定員なしの時間もあります').classList.contains('font-bold')).toBe(false);
    expect(screen.queryByText(/残り 2 席（定員 12）/)).toBeNull();
  });

  it('全て定員のある時間なら従来の合計を保つ', async () => {
    setup(eventDetail(), [slot({ capacity: 5, remaining: 2 }), slot({ id: 'other', capacity: 10, remaining: 5 })], []);
    expect(await screen.findByText('残り 7 席（定員 15）')).toBeTruthy();
    expect(screen.queryByText(/定員なしの時間もあります/)).toBeNull();
  });

  it('全て定員なしなら数を作らず定員なしのまま表示する', async () => {
    setup(eventDetail(), [slot({ capacity: null, remaining: null })], []);
    await screen.findByRole('button', { name: '時間を選んでください' });
    expect(screen.getAllByText('定員なし')).toHaveLength(2);
    expect(screen.queryByText(/定員のある時間/)).toBeNull();
  });
});

it('定員のある時間だけでも一部の残席未取得を合計としない', async () => {
  setup(eventDetail(), [slot({ capacity: 5, remaining: 2 }), slot({ id: 'unknown', capacity: 7, remaining: null })], []);
  expect(await screen.findByText('定員 12 席・残席は各時間で確認してください')).toBeTruthy();
    expect(screen.getByText('定員 12 席・残席は各時間で確認してください').classList.contains('font-bold')).toBe(false);
  expect(screen.queryByText(/残り 2 席（定員 12）/)).toBeNull();
});
