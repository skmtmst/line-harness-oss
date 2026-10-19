// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import WaitlistOfferSheet from './waitlist-offer-sheet.js';
import WaitlistSheet from './waitlist-sheet.js';
vi.mock('../lib/api.js', () => ({ api: { bookingWaitlists: vi.fn(), seatWaitlists: vi.fn(), acceptWaitlist: vi.fn(), acceptSeatWaitlist: vi.fn(), cancelWaitlist: vi.fn(), cancelSeatWaitlist: vi.fn(), waitlistMine: vi.fn() } }));
const { api } = await import('../lib/api.js');
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });
function offered(seat = false) {
  return { id: 'w', status: 'invited' as const, starts_at: '2099-10-11T01:00:00Z', hold_minutes: 30, hold_expires_at: new Date(Date.now() + 1800000).toISOString(), created_at: '', ...(seat ? { store_id: 'st', store_name: '店', guest_count: 2, ends_at: '2099-10-11T02:00:00Z' } : { staff_id: 's', menu_id: 'm', staff_name: '担当', menu_name: 'メニュー' }) };
}
test.each([false, true])('E3: 本物の案内部品で%sの残り時間を示し、期限切れは確定を止める', async seat => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
  const value = offered(seat);
  (seat ? vi.mocked(api.seatWaitlists) : vi.mocked(api.bookingWaitlists)).mockResolvedValue({ waitlist: [value] } as never);
  render(<WaitlistOfferSheet id="w" seat={seat} onClose={() => {}} />);
  await screen.findByText(/残り30分00秒/);
  vi.setSystemTime(new Date('2026-10-11T00:31:00Z'));
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'この枠で予約する' })).toBeNull(), { timeout: 1500 });
});
test('E3: 案内の読込失敗を空にせず、もう一度で復旧する', async () => {
  vi.mocked(api.bookingWaitlists).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ waitlist: [offered()] } as never);
  render(<WaitlistOfferSheet id="w" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度' }));
  await screen.findByRole('button', { name: 'この枠で予約する' });
});
test('E3: 人数枠の登録前照会が失敗したら、空き扱いせずやり直す', async () => {
  vi.mocked(api.waitlistMine).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ entry: null } as never);
  render(<WaitlistSheet menu={{ id: 'm', name: 'メニュー' } as never} staff={{ id: 's', display_name: '担当' } as never} date="2099-10-11" start="10:00" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度' }));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: '空いたら知らせる' })).toHaveProperty('disabled', false));
});
test.each([false, true])('E3: %sの案内から既存の確定と見送りAPIに接続する', async seat => {
  (seat ? vi.mocked(api.seatWaitlists) : vi.mocked(api.bookingWaitlists)).mockResolvedValue({ waitlist: [offered(seat)] } as never);
  vi.mocked(api.acceptWaitlist).mockResolvedValue({ booking_id: 'b', status: 'confirmed' } as never);
  vi.mocked(api.acceptSeatWaitlist).mockResolvedValue({} as never);
  const { unmount } = render(<WaitlistOfferSheet id="w" seat={seat} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'この枠で予約する' }));
  await screen.findByText('予約が確定しました。');
  const accept = seat ? api.acceptSeatWaitlist : api.acceptWaitlist;
  expect(accept).toHaveBeenCalledTimes(1);
  expect(vi.mocked(accept).mock.calls[0]?.[1]).toMatch(/^[\da-f-]{36}$/);
  unmount();
  render(<WaitlistOfferSheet id="w" seat={seat} decline onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: '今回は見送る' }));
  await screen.findByText('取り消しました。次の方へ案内します。');
  expect(seat ? api.cancelSeatWaitlist : api.cancelWaitlist).toHaveBeenCalledWith('w');
});
