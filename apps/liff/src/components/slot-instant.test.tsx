// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { slotStartsAtIso } from '../lib/datetime.js';
import { waitlistStartsAt } from './WaitlistSheet.js';
import type { MenuItem, StaffItem } from '../lib/api.js';

/**
 * 監査 L10：空き枠の開始の瞬間（startUtc）と店のタイムゾーンを、選んだ時から
 * 確認・API まで運ぶ。日本時間以外の店（例：バンコク 13:00 = 06:00Z）で
 * 日本時間として読み直す（04:00Z）とずれる。正しい枠かはサーバーが確かめ直す。
 */

vi.mock('../lib/api.js', () => ({
  api: {
    createRequest: vi.fn().mockResolvedValue({ booking_id: 'bk1', status: 'pending' }),
    availability: vi.fn(),
    bookingSettings: vi.fn().mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 }),
  },
}));
vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
const { default: Confirm } = await import('./Confirm.js');

const MENU: MenuItem = {
  id: 'm1', name: 'カット', category_label: null, description: null,
  duration_minutes: 60, buffer_after_minutes: 0, base_price: 5000, sort_order: 0,
};
const STAFF: StaffItem = {
  id: 's1', display_name: '担当A', role: null, profile_image_url: null, bio: null,
  is_designation_optional: 0, price: 5000, duration_minutes: 60,
};
const BANGKOK = { date: '2026-10-16', start: '13:00', startUtc: '2026-10-16T13:00:00+07:00', timeZone: 'Asia/Bangkok' };

afterEach(() => cleanup());

describe('監査 L10：開始の瞬間を運ぶ', () => {
  it('startUtc があればそれを送る。無いときだけ日本時間として読む', () => {
    expect(slotStartsAtIso(BANGKOK)).toBe('2026-10-16T06:00:00.000Z');
    expect(slotStartsAtIso({ date: '2026-10-16', start: '13:00' })).toBe('2026-10-16T04:00:00.000Z');
    expect(slotStartsAtIso({ date: '2026-10-16', start: '13:00', startUtc: 'こわれた値' })).toBe('2026-10-16T04:00:00.000Z');
  });

  it('空いたら知らせるの登録・照会も startUtc を使う', () => {
    expect(waitlistStartsAt(BANGKOK.date, BANGKOK.start, BANGKOK.startUtc)).toBe('2026-10-16T06:00:00.000Z');
  });

  it('確認の画面から予約を送るとき、選んだ枠の開始の瞬間を送る', async () => {
    render(
      <Confirm menu={MENU} staff={STAFF} slot={BANGKOK} autoConfirm={false} onBack={vi.fn()} onSubmitted={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /予約をリクエスト|予約する|確定/ }));
    await vi.waitFor(() => expect(api.createRequest).toHaveBeenCalled());
    expect(vi.mocked(api.createRequest).mock.calls[0]![0].starts_at).toBe('2026-10-16T06:00:00.000Z');
  });
});
