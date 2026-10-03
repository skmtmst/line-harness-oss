// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WaitlistSheet from './WaitlistSheet.js';
import type { MenuItem, StaffItem } from '../lib/api.js';

/**
 * 1-2 空いたら知らせるの小さなシート (booking-plus 2)。
 * 満席の枠の登録・取り消しができ、結果が文で出る。
 */

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
vi.mock('../lib/api.js', () => ({
  api: {
    waitlistMine: vi.fn(),
    registerWaitlist: vi.fn(),
    cancelWaitlist: vi.fn(),
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
  profile_image_url: null,
  bio: null,
  is_designation_optional: 0,
  price: 5000,
  duration_minutes: 60,
};

const waitlistMine = vi.mocked(api.waitlistMine);
const registerWaitlist = vi.mocked(api.registerWaitlist);
const cancelWaitlist = vi.mocked(api.cancelWaitlist);

function renderSheet() {
  render(
    <WaitlistSheet menu={MENU} staff={STAFF} date="2026-10-18" start="10:00" onClose={vi.fn()} />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WaitlistSheet', () => {
  it('枠と店の名前を出して登録できる', async () => {
    waitlistMine.mockResolvedValue({ entry: null });
    registerWaitlist.mockResolvedValue({ id: 'w1' });
    renderSheet();

    await waitFor(() => expect(waitlistMine).toHaveBeenCalledWith('s1', 'm1', expect.any(String)));
    const dialog = screen.getByRole('dialog', { name: '空いたら知らせる' });
    expect(dialog.textContent).toContain('トリミング（小型犬）');
    expect(dialog.textContent).toContain('担当A');

    fireEvent.click(screen.getByRole('button', { name: '空いたら知らせる' }));
    expect(await screen.findByText('登録しました。空いたらLINEで知らせます。')).toBeTruthy();
    expect(registerWaitlist).toHaveBeenCalledWith({
      staff_id: 's1',
      menu_id: 'm1',
      starts_at: expect.any(String),
    });
  });

  it('登録ずみなら取り消せる', async () => {
    waitlistMine.mockResolvedValue({ entry: { id: 'w1', status: 'waiting', created_at: 'x' } });
    cancelWaitlist.mockResolvedValue({ status: 'cancelled' });
    renderSheet();

    expect(await screen.findByText('登録ずみです。空いたらLINEで1通だけ知らせます。知らせてからしばらくは、あなただけが取れます。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    expect(await screen.findByText('取り消しました。')).toBeTruthy();
    expect(cancelWaitlist).toHaveBeenCalledWith('w1');
  });

  it('失敗したら直し方を出す', async () => {
    waitlistMine.mockRejectedValue(new Error('network down'));
    renderSheet();

    expect(await screen.findByText('読み込めませんでした。電波の良い所でもう一度開いてください。')).toBeTruthy();
  });
});
