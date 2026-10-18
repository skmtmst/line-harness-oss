// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OnlineMeetingCard from './OnlineMeetingCard.js';
import { api } from '../lib/api.js';

/* 予約のあとのオンラインの会議（B7・sjkwK・I5hxa）：確認待ちは URL を出さない。確定は開始 10 分前から終わりまでだけ参加のボタン。 */
vi.mock('../lib/api.js', () => ({ api: { me: vi.fn() } }));
afterEach(cleanup);
const START = Date.parse('2099-01-01T05:00:00.000Z');
function booking(status: string, url: string | null) {
  vi.mocked(api.me).mockResolvedValue({ upcoming: [{ id: 'b1', starts_at: new Date(START).toISOString(), ends_at: new Date(START + 3600000).toISOString(), status, customer_note: null, menu_name: 'オンライン相談', staff_name: '佐々木', profile_image_url: null, meeting_mode: 'online', meeting_url: url, meeting_url_source: url ? 'staff' : null }], past: [] } as never);
}

it('確認待ちは URL もボタンも出さず、確定したら LINE で送ると伝える', async () => {
  booking('requested', null);
  render(<OnlineMeetingCard bookingId="b1" status="requested" now={() => START} />);
  expect(await screen.findByText('確定したら、会議の URL を LINE でお送りします。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '会議に参加する' })).toBeNull();
});

it('確定は開始 10 分前からボタンを出し、それより前は時刻だけ出す', async () => {
  booking('confirmed', 'https://zoom.us/j/1');
  const { unmount } = render(<OnlineMeetingCard bookingId="b1" status="confirmed" now={() => START - 9 * 60000} />);
  expect(await screen.findByRole('button', { name: '会議に参加する' })).toBeTruthy();
  expect(screen.getByText('オンライン（Zoom）')).toBeTruthy();
  unmount();
  render(<OnlineMeetingCard bookingId="b1" status="confirmed" now={() => START - 11 * 60000} />);
  expect(await screen.findByText(/から参加のボタンが出ます/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '会議に参加する' })).toBeNull();
});
