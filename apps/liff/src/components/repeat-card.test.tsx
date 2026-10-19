// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RepeatCard from './RepeatCard.js';
import type { MenuItem, StaffItem } from '../lib/api.js';

/**
 * 1-0 前回と同じで予約の札 (booking-plus 1)。
 * 前回の予約が使えるときだけ札が出て、押すとメニューと担当が渡る。
 * 対象外・失敗は黙って出さない。
 */

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
vi.mock('../lib/api.js', () => ({
  api: {
    menus: vi.fn(),
    lastBooking: vi.fn(),
    staffOf: vi.fn(),
  },
}));

const MENU: MenuItem = {
  id: 'm1',
  name: 'トリミング（小型犬）',
  category_label: null,
  description: null,
  duration_minutes: 60,
  buffer_after_minutes: 0,
  base_price: 5000,
  sort_order: 0,
};
const STAFF: StaffItem = {
  id: 's1',
  display_name: '担当A',
  role: null,
  profile_image_url: 'https://example.com/a.jpg',
  bio: null,
  is_designation_optional: 0,
  price: 5000,
  duration_minutes: 60,
};

function mockReady() {
  vi.mocked(api.menus).mockResolvedValue({ menus: [MENU] });
  vi.mocked(api.lastBooking).mockResolvedValue({
    available: true,
    booking: {
      id: 'b1',
      starts_at: '2026-09-20T05:00:00.000Z',
      status: 'completed',
      menu: { id: 'm1', name: 'トリミング（小型犬）' },
      staff: { id: 's1', display_name: '担当A', profile_image_url: 'https://example.com/a.jpg' },
    },
  });
  vi.mocked(api.staffOf).mockResolvedValue({ staff: [STAFF] });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RepeatCard', () => {
  it('前回の予約が使えるとき写真・メニュー・担当・前回の日を出す', async () => {
    mockReady();
    const onRepeat = vi.fn();
    render(<RepeatCard onRepeat={onRepeat} />);

    const card = await screen.findByRole('button', { name: '前回と同じで予約する' });
    expect(card.textContent).toContain('トリミング（小型犬）');
    expect(card.textContent).toContain('担当A');
    expect(card.textContent).toContain('2026/9/20');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.jpg');

    fireEvent.click(card);
    expect(onRepeat).toHaveBeenCalledWith(MENU, STAFF);
  });

  it('履歴が無いときは何も出さない', async () => {
    vi.mocked(api.menus).mockResolvedValue({ menus: [MENU] });
    vi.mocked(api.lastBooking).mockResolvedValue({ available: false, reason: 'no_history' });
    render(<RepeatCard onRepeat={vi.fn()} />);

    await waitFor(() => expect(api.lastBooking).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '前回と同じで予約する' })).toBeNull();
  });

  it('読み込みに失敗しても今までどおり何も出さない', async () => {
    vi.mocked(api.menus).mockRejectedValue(new Error('network down'));
    render(<RepeatCard onRepeat={vi.fn()} />);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: '前回と同じで予約する' })).toBeNull();
  });
});
