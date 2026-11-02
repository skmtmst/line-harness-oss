// @vitest-environment happy-dom
import { useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { MenuItem, StaffItem } from '../lib/api.js';
import type { SlotPick } from '../components/date-time-picker.js';
import Booking from './booking.js';

const data = vi.hoisted(() => ({
  menu: { id: 'menu', name: '通常メニュー', base_price: 8000, duration_minutes: 60 },
  staff: { id: 'staff', display_name: '担当者', price: 9000, duration_minutes: 60, nomination_fee: 1000, is_designation_optional: 0 },
  addons: [{ id: 'addon', name: '追加メニュー', price: 300, duration_minutes: 30 }],
}));
const addonRequest = vi.hoisted(() => vi.fn());
vi.mock('../lib/api.js', () => ({ api: { menus: async () => ({ menus: [data.menu] }), addons: (...args: unknown[]) => addonRequest(...args), bookingSettings: async () => ({}), storePhotos: async () => [] } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: ({ onBack }: { onBack?: () => void }) => onBack ? <button onClick={onBack}>前の段へ</button> : null }));
vi.mock('../components/repeat-card.js', () => ({ default: () => null }));
vi.mock('../components/menu-list.js', () => ({ default: ({ onSelect, onLoadState }: { onSelect: (menu: MenuItem) => void; onLoadState: (ready: boolean) => void }) => {
  useEffect(() => { onLoadState(true); }, [onLoadState]);
  return <button onClick={() => onSelect(data.menu as MenuItem)}>メニューを選択</button>;
} }));
vi.mock('../components/staff-list.js', async importOriginal => ({ ...(await importOriginal<typeof import('../components/staff-list.js')>()), default: ({ onSelect, onLoadState }: { onSelect: (staff: StaffItem) => void; onLoadState: (ready: boolean) => void }) => {
  useEffect(() => { void Promise.resolve().then(() => onLoadState(true)); }, [onLoadState]);
  return <button onClick={() => onSelect(data.staff as StaffItem)}>担当者を選択</button>;
} }));
vi.mock('../components/date-time-picker.js', () => ({ default: ({ selected, addonIds, additionalDurationMinutes, onSelect }: { selected: SlotPick | null; addonIds: string[]; additionalDurationMinutes: number; onSelect: (slot: SlotPick) => void }) => <>
  <output aria-label="日時の条件">{JSON.stringify({ selected, addonIds, additionalDurationMinutes })}</output>
  <button onClick={() => onSelect({ date: '2030-10-20', start: '10:00' })}>日時を選択</button>
</> }));
afterEach(() => { cleanup(); addonRequest.mockReset(); });
it('追加メニューの確認が終わるまで先へ進めない', async () => {
  let finish!: (value: unknown) => void;
  addonRequest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter initialEntries={['/booking']}><Booking /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'メニューを選択' }));
  expect(await screen.findByText(/追加メニューを読み込んでいます/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '担当を選ぶ' })).toBeNull();
  await act(async () => finish(data.addons));
  expect(await screen.findByRole('button', { name: '担当を選ぶ' })).toBeTruthy();
});
it('追加メニューの読込失敗を知らせて再試行でき、成功まで先へ進めない', async () => {
  addonRequest.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(data.addons);
  render(<MemoryRouter initialEntries={['/booking']}><Booking /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'メニューを選択' }));
  expect(await screen.findByText(/追加メニューを読み込めませんでした/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '担当を選ぶ' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByRole('button', { name: '担当を選ぶ' })).toBeTruthy();
  expect(addonRequest).toHaveBeenCalledTimes(2);
});

it('同じメニューを再選択しても先の応答では進めない', async () => {
  let finishOld!: (value: unknown) => void;
  let finishNew!: (value: unknown) => void;
  addonRequest.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  render(<MemoryRouter initialEntries={['/booking']}><Booking /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'メニューを選択' }));
  await screen.findByText(/追加メニューを読み込んでいます/);
  fireEvent.click(screen.getByRole('button', { name: 'メニューを選び直す' }));
  fireEvent.click(await screen.findByRole('button', { name: 'メニューを選択' }));
  await screen.findByText(/追加メニューを読み込んでいます/);
  await act(async () => finishOld(data.addons));
  expect(screen.queryByRole('button', { name: '担当を選ぶ' })).toBeNull();
  await act(async () => finishNew(data.addons));
  expect(await screen.findByRole('button', { name: '担当を選ぶ' })).toBeTruthy();
});
