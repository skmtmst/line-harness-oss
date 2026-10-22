// @vitest-environment happy-dom
import { useEffect, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
vi.mock('../lib/api.js', () => ({ api: { menus: async () => ({ menus: [data.menu] }), addons: async () => data.addons, bookingSettings: async () => ({}), storePhotos: async () => [] } }));
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
afterEach(cleanup);
const datetime = () => JSON.parse(screen.getByLabelText('日時の条件').textContent!);
async function chooseAddonAndStaff() {
  render(<MemoryRouter initialEntries={['/booking']}><Booking /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'メニューを選択' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /追加メニュー/ }));
  fireEvent.click(screen.getByRole('button', { name: '担当を選ぶ' }));
  fireEvent.click(await screen.findByRole('button', { name: '担当者を選択' }));
}
it('一人の追加メニューにも担当者料金と指名料を含め、日時へ追加内容と所要時間を渡す', async () => {
  await chooseAddonAndStaff();
  const summary = document.querySelector('[data-party-summary]')!;
  expect(summary.textContent).toContain('指名料（担当者）');
  expect(summary.textContent).toContain('¥1,000');
  expect(summary.textContent).toContain('1 人 ・ 同時に 90 分 ・ ¥10,300');
  fireEvent.click(await screen.findByRole('button', { name: '日時を選ぶ' }));
  expect(datetime()).toEqual({ selected: null, addonIds: ['addon'], additionalDurationMinutes: 30 });
});
it('戻って追加メニューを変えると以前の日時選択を破棄する', async () => {
  await chooseAddonAndStaff();
  fireEvent.click(await screen.findByRole('button', { name: '日時を選ぶ' }));
  fireEvent.click(screen.getByRole('button', { name: '日時を選択' }));
  expect(datetime().selected).toEqual({ date: '2030-10-20', start: '10:00' });
  fireEvent.click(screen.getByRole('button', { name: '前の段へ' }));
  fireEvent.click(screen.getByRole('button', { name: '前の段へ' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /追加メニュー/ }));
  fireEvent.click(screen.getByRole('button', { name: '担当を選ぶ' }));
  fireEvent.click(await screen.findByRole('button', { name: '日時を選ぶ' }));
  expect(datetime()).toEqual({ selected: null, addonIds: [], additionalDurationMinutes: 0 });
});
