// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DateTimePicker from './date-time-picker.js';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { availability: vi.fn(), bookingSettings: vi.fn() } }));
vi.mock('../lib/user-message.js', async load => ({ ...await load<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const menu: MenuItem = { id: 'menu', name: 'カット', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 5000, sort_order: 0 };
const staff: StaffItem = { id: 'staff', display_name: '指名なし', role: null, profile_image_url: null, bio: null, is_designation_optional: 1, price: 5000, duration_minutes: 60 };
const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
function settings(days = 7, dots = 1) { vi.mocked(api.bookingSettings).mockResolvedValue({ liff_date_view: 'calendar', liff_calendar_mode: 'month-only', liff_vacancy_dots: dots, booking_window_days: days }); }
function draw(selected: { date: string; start: string } | null = null) { const select = vi.fn(), confirm = vi.fn(); render(<DateTimePicker menu={menu} staff={staff} selected={selected} onSelect={select} onConfirm={confirm} onBackToStaff={vi.fn()} />); return { select, confirm }; }
beforeEach(() => { vi.resetAllMocks(); memory.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T03:00:00Z')); settings(); vi.mocked(api.availability).mockResolvedValue({ by_staff: [], closed_dates: [] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('カレンダーで確認した受付期間', () => {
  it('取得した期間を示し、受付期間外は空きなしと区別して押せない', async () => {
    const cb = draw(); await screen.findByText('この月の受付期間：11月1日（日）〜11月8日（日）');
    expect(api.availability).toHaveBeenCalledExactlyOnceWith('menu', 'staff', '2026-11-01', '2026-11-08', []);
    const off = screen.getByRole('button', { name: '11月9日 受付期間外' }); expect(off.textContent).toContain('受付外'); expect(off).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '11月8日 空きなし' })).toHaveProperty('disabled', true);
    fireEvent.click(off); expect(cb.select).not.toHaveBeenCalled(); expect(cb.confirm).not.toHaveBeenCalled();
    expect(screen.getByText('この月の受付期間内に空きがありません。')).toBeTruthy(); expect(screen.queryByText('この月は空きがありません。')).toBeNull();
  });
  it('末尾の月は取得した1日だけを示し自動月送りと受付端を維持する', async () => {
    settings(30); draw(); await screen.findByText('この月の受付期間：12月1日（火）');
    expect(api.availability).toHaveBeenLastCalledWith('menu', 'staff', '2026-12-01', '2026-12-01', []);
    expect(screen.getByRole('button', { name: '12月2日 受付期間外' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '次の月' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '前の月' })); await screen.findByText('この月の受付期間：11月1日（日）〜11月30日（月）'); expect(api.availability).toHaveBeenCalledTimes(3);
  });
  it('月全体が受付内なら期間外の札は出ず28日ごとの取得を維持する', async () => {
    settings(29); draw(); await screen.findByText('この月の受付期間：11月1日（日）〜11月30日（月）');
    expect(screen.queryAllByRole('button', { name: /受付期間外/ })).toHaveLength(0);
    expect(vi.mocked(api.availability).mock.calls.map(call => call.slice(2, 4))).toEqual([['2026-11-01', '2026-11-28'], ['2026-11-29', '2026-11-30']]);
  });
  it('空き・満席・休みの状態と選択は変えず過去日も区別する', async () => {
    vi.setSystemTime(new Date('2026-11-03T03:00:00Z'));
    vi.mocked(api.availability).mockResolvedValue({ by_staff: [{ staff_id: 'staff', display_name: '指名なし', slots: [{ date: '2026-11-04', start: '10:00', end: '11:00' }, { date: '2026-11-05', start: '10:00', end: '11:00', state: 'full', remaining: 0 }] }], closed_dates: ['2026-11-06'] });
    draw(); await screen.findByRole('button', { name: '11月4日 空きあり' });
    expect(screen.getByRole('button', { name: '11月2日 過ぎた日' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '11月4日 空きあり' })).toHaveProperty('disabled', false);
    const full = screen.getByRole('button', { name: '11月5日 満席' }); expect(full).toHaveProperty('disabled', false); fireEvent.click(full); expect(full.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '11月6日 お休み' })).toHaveProperty('disabled', true);
  });
  it('空きの点を出さない設定でも受付外の文字は残る', async () => {
    settings(7, 0); draw(); await screen.findByText('この月の受付期間：11月1日（日）〜11月8日（日）'); expect(screen.getByRole('button', { name: '11月9日 受付期間外' }).textContent).toContain('受付外');
  });
  it('失敗は期間を確定表示せず同じGETの再試行で復旧する', async () => {
    vi.mocked(api.availability).mockRejectedValueOnce(new Error('offline')); draw(); const retry = await screen.findByRole('button', { name: 'もう一度読み込む' });
    expect(screen.queryByText(/^この月の受付期間：/)).toBeNull(); fireEvent.click(retry); await screen.findByText('この月の受付期間：11月1日（日）〜11月8日（日）'); expect(vi.mocked(api.availability).mock.calls[0]).toEqual(vi.mocked(api.availability).mock.calls[1]);
  });
  it('未取得の間は受付期間や空きなしを断定しない', async () => {
    let done: (value: { by_staff: []; closed_dates: [] }) => void = () => {};
    vi.mocked(api.availability).mockReturnValue(new Promise(resolve => { done = resolve; })); draw(); await waitFor(() => expect(api.availability).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/^この月の受付期間：/)).toBeNull(); expect(screen.queryByText('この月の受付期間内に空きがありません。')).toBeNull(); done({ by_staff: [], closed_dates: [] }); await screen.findByText('この月の受付期間：11月1日（日）〜11月8日（日）');
  });
  it('空きのある月から戻った月だけを空きなしと案内する', async () => {
    settings(30); vi.mocked(api.availability).mockImplementation(async (_m, _s, from) => ({ by_staff: [{ staff_id: 'staff', display_name: '指名なし', slots: from === '2026-12-01' ? [{ date: '2026-12-01', start: '10:00', end: '11:00' }] : [] }], closed_dates: [] }));
    draw(); await screen.findByRole('button', { name: '12月1日 空きあり' }); fireEvent.click(screen.getByRole('button', { name: '前の月' }));
    await screen.findByText('この月の受付期間内に空きがありません。'); expect(screen.getByText('この月の受付期間：11月1日（日）〜11月30日（月）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '次の月' })); await screen.findByRole('button', { name: '12月1日 空きあり' }); expect(api.availability).toHaveBeenCalledTimes(3);
  });
  it('選択日が受付期間外の月でも逆転した期間は示さない', async () => {
    draw({ date: '2026-12-01', start: '10:00' }); await screen.findByText('この月は受付期間外です。');
    expect(screen.queryByText(/^この月の受付期間：/)).toBeNull(); expect(api.availability).not.toHaveBeenCalled();
  });

});
