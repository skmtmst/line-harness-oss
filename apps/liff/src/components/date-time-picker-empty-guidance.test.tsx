// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DateTimePicker from './date-time-picker.js';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { availability: vi.fn(), bookingSettings: vi.fn() } }));
vi.mock('../lib/user-message.js', async load => ({ ...await load<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const menu: MenuItem = { id: 'menu', name: 'カット', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 5000, sort_order: 0 };
const staff: StaffItem = { id: 'staff', display_name: '担当A', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 5000, duration_minutes: 60 };
const neutral = '次の週を見るか、担当を選び直してください。';
const named = '次の週を見るか、担当を「指名なし」にすると見つかることがあります。';
const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
function draw(flag: number, name = '担当A') {
  const back = vi.fn(), select = vi.fn(), confirm = vi.fn();
  render(<DateTimePicker menu={menu} staff={{ ...staff, display_name: name, is_designation_optional: flag }} selected={null} onSelect={select} onConfirm={confirm} onBackToStaff={back} />);
  return { back, select, confirm };
}
beforeEach(() => {
  vi.clearAllMocks(); memory.clear();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));
  vi.mocked(api.bookingSettings).mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 });
  vi.mocked(api.availability).mockResolvedValue({ by_staff: [], closed_dates: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('空きのない週の担当案内', () => {
  it.each([1, 2])('指名なし選択済みまたは不明（%s）は実在する操作だけを案内する', async flag => {
    const callbacks = draw(flag);
    expect(await screen.findByText(neutral)).toBeTruthy();
    expect(screen.queryByText(named)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '担当を選び直す' }));
    expect(callbacks.back).toHaveBeenCalledTimes(1);
    expect(callbacks.select).not.toHaveBeenCalled(); expect(callbacks.confirm).not.toHaveBeenCalled();
  });
  it('指名ありは従来の案内を保ち、名前から選択状態を推測しない', async () => {
    draw(0, '指名なし');
    expect(await screen.findByText(named)).toBeTruthy();
  });
  it.each([0, 1, 2])('取得失敗（%s）は空週の案内を出さず同じ担当で読み直す', async flag => {
    vi.mocked(api.availability).mockRejectedValueOnce(new Error('network'));
    draw(flag);
    fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }));
    expect(await screen.findByText('この週は空きがありません')).toBeTruthy();
    expect(api.availability).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.availability).mock.calls[1]).toEqual(vi.mocked(api.availability).mock.calls[0]);
  });
  it('次週へ進むと同じ担当の取得期間が5日進む', async () => {
    const callbacks = draw(1); await screen.findByText(neutral);
    fireEvent.click(screen.getByRole('button', { name: '次の週を見る' }));
    await waitFor(() => expect(api.availability).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.availability).mock.calls;
    expect(calls[1].slice(0, 2)).toEqual(['menu', 'staff']);
    expect(calls[0][2]).toBe('2026-11-01');
    expect(calls[1][2]).toBe('2026-11-06');
    expect(calls[1][3]).toBe('2026-11-10');
    expect(await screen.findByText(neutral)).toBeTruthy();
    expect(callbacks.select).not.toHaveBeenCalled(); expect(callbacks.confirm).not.toHaveBeenCalled();
  });
});
