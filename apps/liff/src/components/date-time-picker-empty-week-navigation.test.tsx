// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DateTimePicker from './date-time-picker.js';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { availability: vi.fn(), bookingSettings: vi.fn() } }));
vi.mock('../lib/user-message.js', async load => ({ ...await load<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const menu: MenuItem = { id: 'menu', name: 'カット', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 5000, sort_order: 0 };
const staff: StaffItem = { id: 'staff', display_name: '指名なし', role: null, profile_image_url: null, bio: null, is_designation_optional: 1, price: 5000, duration_minutes: 60 };
const first = '11月1日（日）〜11月5日（木）', next = '11月6日（金）〜11月10日（火）';
const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
function draw() {
  const select = vi.fn(), confirm = vi.fn(), back = vi.fn();
  render(<DateTimePicker menu={menu} staff={staff} selected={null} onSelect={select} onConfirm={confirm} onBackToStaff={back} />); return { select, confirm, back };
}
beforeEach(() => {
  vi.resetAllMocks(); memory.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));
  vi.mocked(api.bookingSettings).mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 });
  vi.mocked(api.availability).mockResolvedValue({ by_staff: [], closed_dates: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('空きのない週の表示期間と移動', () => {
  it('最初の5日間を示し、戻る操作は使えず次へは進める', async () => {
    draw(); expect(await screen.findByText(first)).toBeTruthy();
    expect(screen.getByRole('button', { name: '前の週を見る' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '次の週を見る' })).toHaveProperty('disabled', false);
    expect(screen.getByText('次の週を見るか、担当を選び直してください。')).toBeTruthy();
  });
  it('次の5日間へ進み、同じ担当の取得済みの期間へ戻れる', async () => {
    const callbacks = draw(); await screen.findByText(first);
    fireEvent.click(screen.getByRole('button', { name: '次の週を見る' })); await screen.findByText(next);
    expect(api.availability).toHaveBeenLastCalledWith('menu', 'staff', '2026-11-06', '2026-11-10', []);
    fireEvent.click(screen.getByRole('button', { name: '前の週を見る' })); await screen.findByText(first);
    expect(api.availability).toHaveBeenCalledTimes(2);
    expect(callbacks.select).not.toHaveBeenCalled(); expect(callbacks.confirm).not.toHaveBeenCalled();
  });
  it('受付期間の端は表示と取得を同じ日で止める', async () => {
    vi.mocked(api.bookingSettings).mockResolvedValue({ liff_date_view: 'list', booking_window_days: 7 });
    draw(); await screen.findByText(first); fireEvent.click(screen.getByRole('button', { name: '次の週を見る' }));
    await screen.findByText('11月6日（金）〜11月8日（日）');
    expect(api.availability).toHaveBeenLastCalledWith('menu', 'staff', '2026-11-06', '2026-11-08', []);
    expect(screen.getByRole('button', { name: '次の週を見る' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '前の週を見る' })).toHaveProperty('disabled', false);
  });
  it('取得失敗は期間を確定表示せず同じ範囲の再読込で復旧する', async () => {
    vi.mocked(api.availability).mockRejectedValueOnce(new Error('offline')); draw();
    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' }); expect(screen.queryByText(first)).toBeNull();
    fireEvent.click(retry); await screen.findByText(first);
    expect(vi.mocked(api.availability).mock.calls[0]).toEqual(vi.mocked(api.availability).mock.calls[1]);
  });
  it('空きのある期間は日の並びを使い、空週用の移動操作を出さない', async () => {
    vi.mocked(api.availability).mockResolvedValue({ by_staff: [{ staff_id: 'staff', display_name: '指名なし', slots: [{ date: '2026-11-02', start: '10:00', end: '11:00' }] }], closed_dates: [] });
    draw(); await screen.findByRole('button', { name: '11月2日 空きあり' });
    expect(screen.queryByRole('button', { name: '前の週を見る' })).toBeNull(); expect(screen.queryByText(first)).toBeNull();
  });
  it('期間の移動で読み込み中は古い期間の案内を出さない', async () => {
    let done: (value: { by_staff: []; closed_dates: [] }) => void = () => {};
    vi.mocked(api.availability).mockResolvedValueOnce({ by_staff: [], closed_dates: [] }).mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
    draw(); await screen.findByText(first); fireEvent.click(screen.getByRole('button', { name: '次の週を見る' }));
    await waitFor(() => expect(api.availability).toHaveBeenCalledTimes(2)); expect(screen.queryByText(first)).toBeNull();
    done({ by_staff: [], closed_dates: [] }); await screen.findByText(next);
  });
});
