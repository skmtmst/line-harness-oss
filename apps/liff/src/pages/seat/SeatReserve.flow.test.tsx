// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RestaurantCustomerBooking, RestaurantCustomerSlot } from '@line-crm/shared';

/**
 * 席の予約 (E-11) の動き。
 * - ① で時刻を選ぶと仮押さえ (店・時刻・人数・受付番号) → ② で返った版を指定して確定 → ③
 * - 届いたか分からない失敗の再試行は同じ受付番号、断られたら新しい番号
 * - 仮押さえの期限切れは確定できない
 * - リンクが無いときは案内を出す
 */

vi.mock('@line/liff', () => ({
  default: { getProfile: vi.fn().mockResolvedValue({ displayName: '山田 花子' }), closeWindow: vi.fn() },
}));
vi.mock('../../lib/api.js', () => ({
  api: {
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: { accountName: '然 - NEN -' } }),
    bookingSettings: vi.fn().mockResolvedValue({}),
  },
  restaurantBookingApi: {
    link: vi.fn(),
    availability: vi.fn(),
    hold: vi.fn(),
    mine: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    reschedule: vi.fn(),
  },
}));
vi.mock('../../lib/user-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { restaurantBookingApi: seat } = await import('../../lib/api.js');
const { default: SeatReserve } = await import('./SeatReserve.js');

function slots(date: string): RestaurantCustomerSlot[] {
  return ['18:00', '19:00', '19:30'].map((hm) => {
    const startsAt = new Date(`${date}T${hm}:00+09:00`).toISOString();
    return {
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 7200000).toISOString(),
      available: hm !== '19:30',
      remainingTables: hm === '19:30' ? 0 : 3,
      seatTypes: ['table'],
    };
  });
}
function held(over: Partial<RestaurantCustomerBooking> = {}): RestaurantCustomerBooking {
  return {
    id: 'r1',
    storeId: 'st',
    startsAt: new Date('2026-10-07T19:00:00+09:00').toISOString(),
    endsAt: new Date('2026-10-07T21:00:00+09:00').toISOString(),
    guestCount: 2,
    status: 'pending',
    version: 3,
    holdExpiresAt: new Date(Date.now() + 600000).toISOString(),
    note: null,
    customerPhone: null,
    seatType: 'table',
    ...over,
  };
}
function err(status: number, error: string) {
  return Object.assign(new Error(`API ${status}`), { status, body: { success: false, error } });
}

function open() {
  render(
    <MemoryRouter initialEntries={['/restaurant/reserve/tok']}>
      <Routes>
        <Route path="/restaurant/reserve/:token" element={<SeatReserve />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
  vi.mocked(seat.link).mockResolvedValue({ success: true, data: { id: 'st', name: '然 - NEN - 本店', timezone: 'Asia/Tokyo' } });
  vi.mocked(seat.availability).mockImplementation(async (_s, date, guestCount) => ({
    success: true,
    data: { storeId: 'st', date, guestCount, slots: slots(date), cancelDeadlineMinutesBefore: 120, cutoffMinutesBefore: 60 },
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('席の予約の流れ', () => {
  it('時刻を選ぶと仮押さえし、返った版で確定して受け付けましたへ進む', async () => {
    vi.mocked(seat.hold).mockResolvedValue({ success: true, data: held() });
    vi.mocked(seat.confirm).mockResolvedValue({ success: true, data: held({ status: 'confirmed', version: 4, holdExpiresAt: null }) });
    open();
    fireEvent.click(await screen.findByRole('radio', { name: '19:00 空きあり' }));
    expect(screen.getByRole('radio', { name: '19:30 満席' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で進む' }));
    await screen.findByText('この内容で予約します');
    const body = vi.mocked(seat.hold).mock.calls[0]![0];
    expect(body).toMatchObject({ storeId: 'st', startsAt: new Date('2026-10-07T19:00:00+09:00').toISOString(), guestCount: 2 });
    expect(body.requestId).toMatch(/^[a-zA-Z0-9_-]{8,128}$/);
    expect(screen.getByText('山田 花子 さま')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toContain('10分 お取りしています');
    fireEvent.click(screen.getByRole('button', { name: '予約を確定する' }));
    await screen.findByText('ご予約を受け付けました');
    expect(seat.confirm).toHaveBeenCalledWith('r1', 3, { note: null, customerPhone: null });
    expect(screen.getByText('予約済み')).toBeTruthy();
    expect(screen.getByText('2名・テーブル席')).toBeTruthy();
  });

  it('ご要望と電話（任意）を入れて確定の口へ送る。お席・遅れたときの決まり・休みの理由を出す', async () => {
    vi.mocked(seat.availability).mockImplementation(async (_s, date, guestCount) => ({
      success: true,
      data: date === '2026-10-09'
        ? { storeId: 'st', date, guestCount, slots: [], unavailableReason: 'temporary_closed' as const, cancelDeadlineMinutesBefore: 120, cutoffMinutesBefore: 60 }
        : { storeId: 'st', date, guestCount, slots: slots(date), cancelDeadlineMinutesBefore: 120, cutoffMinutesBefore: 60,
          lateArrivalPolicy: { cancelAfterMinutes: 15, message: '15分を過ぎてご連絡がない場合は、取り消しになることがあります' } },
    }));
    vi.mocked(seat.hold).mockResolvedValue({ success: true, data: held() });
    vi.mocked(seat.confirm).mockResolvedValue({ success: true, data: held({ status: 'confirmed', version: 4, holdExpiresAt: null, note: '記念日です' }) });
    open();
    expect(await screen.findByText('10/9（金）は臨時休業のため選べません')).toBeTruthy();
    fireEvent.click(await screen.findByRole('radio', { name: '19:00 空きあり' }));
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で進む' }));
    await screen.findByText('この内容で予約します');
    expect(screen.getByText('テーブル席（お店で決めます）')).toBeTruthy();
    expect(screen.getByText('・15分を過ぎてご連絡がない場合は、取り消しになることがあります')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/ご要望/), { target: { value: '記念日です' } });
    fireEvent.change(screen.getByLabelText('電話'), { target: { value: '090ー1111ー2222' } });
    fireEvent.click(screen.getByRole('button', { name: '予約を確定する' }));
    await screen.findByText('ご予約を受け付けました');
    expect(seat.confirm).toHaveBeenCalledWith('r1', 3, { note: '記念日です', customerPhone: '090-1111-2222' });
  });

  it('電話の形が違うときは送らずに理由を出す', async () => {
    vi.mocked(seat.hold).mockResolvedValue({ success: true, data: held() });
    open();
    fireEvent.click(await screen.findByRole('radio', { name: '19:00 空きあり' }));
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で進む' }));
    await screen.findByText('この内容で予約します');
    fireEvent.change(screen.getByLabelText('電話'), { target: { value: 'でんわ' } });
    fireEvent.click(screen.getByRole('button', { name: '予約を確定する' }));
    expect(await screen.findByText('電話番号は数字とハイフンで入れてください。')).toBeTruthy();
    expect(seat.confirm).not.toHaveBeenCalled();
  });

  it('届いたか分からない失敗の再試行は同じ受付番号、断られたら新しい番号', async () => {
    vi.mocked(seat.hold)
      .mockRejectedValueOnce(err(500, 'booking_failed'))
      .mockRejectedValueOnce(err(409, 'slot_conflict'));
    open();
    fireEvent.click(await screen.findByRole('radio', { name: '19:00 空きあり' }));
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で進む' }));
    await screen.findByText(/送信できませんでした/);
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で進む' }));
    await screen.findByText(/ほかの方の予約で埋まりました/);
    const ids = vi.mocked(seat.hold).mock.calls.map((c) => c[0].requestId);
    expect(ids[0]).toBe(ids[1]);
    vi.mocked(seat.hold).mockResolvedValueOnce({ success: true, data: held() });
    fireEvent.click(await screen.findByRole('radio', { name: '18:00 空きあり' }));
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で進む' }));
    await screen.findByText('この内容で予約します');
    expect(vi.mocked(seat.hold).mock.calls[2]![0].requestId).not.toBe(ids[1]);
  });

  it('仮押さえが切れたら確定のボタンを押せない', async () => {
    vi.mocked(seat.hold).mockResolvedValue({ success: true, data: held() });
    vi.mocked(seat.confirm).mockRejectedValue(err(409, 'hold_expired'));
    open();
    fireEvent.click(await screen.findByRole('radio', { name: '19:00 空きあり' }));
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で進む' }));
    fireEvent.click(await screen.findByRole('button', { name: '予約を確定する' }));
    await screen.findAllByText(/お取りしていた時間が過ぎました/);
    expect(screen.getByRole('button', { name: '予約を確定する' })).toHaveProperty('disabled', true);
  });

  it('予約のリンクが無いときは案内を出す', async () => {
    vi.mocked(seat.link).mockRejectedValue(err(404, 'not_found'));
    open();
    await screen.findByText('予約のページが見つかりません');
  });
});
