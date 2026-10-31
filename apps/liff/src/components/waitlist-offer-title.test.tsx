// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CustomerBookingWaitlist, CustomerSeatWaitlist } from '@line-crm/shared';
import WaitlistOfferSheet from './waitlist-offer-sheet.js';
const mocks = vi.hoisted(() => ({ bookingWaitlists: vi.fn(), seatWaitlists: vi.fn(), acceptWaitlist: vi.fn(), acceptSeatWaitlist: vi.fn(), cancelWaitlist: vi.fn(), cancelSeatWaitlist: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: mocks }));
vi.mock('./booking-payment.js', () => ({ default: () => <h2>既存の支払い部品</h2> }));
const person: CustomerBookingWaitlist = { id: 'w', staff_id: 's', menu_id: 'm', starts_at: '2026-11-02T03:00:00Z', status: 'invited', hold_expires_at: '2026-11-01T03:30:00Z', hold_minutes: 30, created_at: '2026-11-01', menu_name: 'カット', staff_name: '担当A' };
const seatEntry: CustomerSeatWaitlist = { id: 'w', store_id: 'store', store_name: '駅前店', guest_count: 2, starts_at: person.starts_at, ends_at: '2026-11-02T04:00:00Z', status: 'invited', hold_expires_at: person.hold_expires_at, hold_minutes: 30, created_at: person.created_at };
function setup(seat: boolean, status: CustomerBookingWaitlist['status'] = 'invited', expires: string | null = person.hold_expires_at) {
  const get = seat ? mocks.seatWaitlists : mocks.bookingWaitlists;
  get.mockResolvedValue({ waitlist: [{ ...(seat ? seatEntry : person), status, hold_expires_at: expires }] });
  return get;
}
function draw(seat: boolean, decline = false) { const close = vi.fn(); render(<WaitlistOfferSheet id="w" seat={seat} decline={decline} onClose={close} />); return close; }
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T03:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe.each([false, true])('案内の見出し（席=%s）', seat => {
  it.each([
    ['waiting', null, '空きの案内を待っています', 'まだ空きの案内を待っています。'],
    ['converted', null, 'この案内は予約になりました', 'この案内は予約になりました。'],
    ['cancelled', null, 'この待ちは終了しました', 'この待ちは終わりました。仮押さえはありません。'],
    ['finished', null, 'この待ちは終了しました', 'この待ちは終わりました。仮押さえはありません。'],
    ['invited', '2026-11-01T02:59:59Z', 'この待ちは終了しました', 'この待ちは終わりました。仮押さえはありません。'],
    ['invited', null, 'この待ちは終了しました', 'この待ちは終わりました。仮押さえはありません。'],
  ] as const)('%s/%sは現在の状態を見出しにする', async (status, expires, title, body) => {
    setup(seat, status, expires); draw(seat); await screen.findByText(body);
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'この枠で予約する' })).toBeNull();
  });
  it('読み込み中は確認中の見出しで予約操作を出さない', () => {
    (seat ? mocks.seatWaitlists : mocks.bookingWaitlists).mockReturnValue(new Promise(() => {})); draw(seat);
    expect(screen.getByRole('heading', { name: '案内を確認しています' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'この枠で予約する' })).toBeNull();
  });
  it('失敗と該当なしは空きの案内にせず、同じIDで再読込する', async () => {
    const get = setup(seat); get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ waitlist: [] }); draw(seat);
    await screen.findByRole('alert'); expect(screen.getByRole('heading', { name: '案内を確認できません' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' })); await screen.findByText('この案内が見つかりません。');
    expect(screen.getByRole('heading', { name: '案内を確認できません' })).toBeTruthy(); expect(get.mock.calls).toEqual([['w'], ['w']]);
  });
  it('有効招待と見送りは従来の見出しと操作を保つ', async () => {
    setup(seat); const close = draw(seat, true); await screen.findByRole('timer');
    expect(screen.getByRole('heading', { name: '今回は見送る' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'この枠で予約する' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '閉じる' }).at(-1)!); expect(close).toHaveBeenCalledTimes(1);
  });
  it('期限を過ぎると見出しも有効招待を示さなくなる', async () => {
    setup(seat); draw(seat); await screen.findByRole('timer'); expect(screen.getByRole('heading', { name: '空きが出ました' })).toBeTruthy();
    vi.setSystemTime(new Date('2026-11-01T03:30:00Z'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'この待ちは終了しました' })).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByRole('button', { name: 'この枠で予約する' })).toBeNull();
  });
  it('処理中・失敗・完了を見出しに示し同じ受付キーで再試行する', async () => {
    setup(seat); const accept = seat ? mocks.acceptSeatWaitlist : mocks.acceptWaitlist;
    let reject: (error: Error) => void = () => {};
    accept.mockReturnValueOnce(new Promise((_, no) => { reject = no; })).mockResolvedValueOnce(seat ? { status: 'confirmed' } : { booking_id: 'b', status: 'confirmed' });
    draw(seat); fireEvent.click(await screen.findByRole('button', { name: 'この枠で予約する' }));
    expect(screen.getByRole('heading', { name: '手続き中です' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'この枠で予約する' })).toHaveProperty('disabled', true);
    reject(new Error('offline')); await screen.findByRole('alert'); expect(screen.getByRole('heading', { name: '手続きを完了できませんでした' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'この枠で予約する' })); await screen.findByText('予約が確定しました。');
    expect(screen.getByRole('heading', { name: '手続きが完了しました' })).toBeTruthy(); expect(accept.mock.calls[0]).toEqual(accept.mock.calls[1]);
    expect(accept.mock.calls[0][1]).toMatch(/^[\da-f-]{36}$/);
  });
});
it('予約後の支払いは既存部品に任せ、空きの案内を見出しに残さない', async () => {
  setup(false); mocks.acceptWaitlist.mockResolvedValue({ booking_id: 'b', status: 'requested', payment: { id: 'p', status: 'unpaid' } }); draw(false);
  fireEvent.click(await screen.findByRole('button', { name: 'この枠で予約する' })); await screen.findByText('既存の支払い部品');
  expect(screen.getAllByRole('heading')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: '既存の支払い部品' })).toBeTruthy();
});
