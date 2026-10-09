// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Booking from './Booking.js';
import type { MenuItem } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { menus: vi.fn(), bookingSettings: vi.fn().mockResolvedValue({ approval_mode: 'manual' }) } }));
vi.mock('../components/MenuList.js', () => ({ default: ({ onSelect }: { onSelect: (m: MenuItem) => void }) => <button onClick={() => onSelect({ id: 'manual', name: '自分で選んだ' } as MenuItem)}>メニュー一覧</button> }));
vi.mock('../components/StaffList.js', () => ({ default: ({ menu }: { menu: MenuItem }) => <div>担当選択:{menu.name}</div> }));
vi.mock('../components/RepeatCard.js', () => ({ default: () => null }));
vi.mock('../components/DateTimePicker.js', () => ({ default: () => null }));
vi.mock('../components/Confirm.js', () => ({ default: () => null }));
vi.mock('../components/BookingPayment.js', () => ({ default: () => null }));
vi.mock('../components/Done.js', () => ({ default: () => null }));
vi.mock('../components/WaitlistOfferSheet.js', () => ({ default: () => null }));
vi.mock('../components/ui/LiffHeader.js', () => ({ default: () => null }));
vi.mock('../components/LiffLookScope.js', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const { api } = await import('../lib/api.js');
const menus = vi.mocked(api.menus);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function open(search = '?menu_id=chosen') { render(<MemoryRouter initialEntries={[`/booking${search}`]}><Booking /></MemoryRouter>); }

test('指定された公開メニューを選び、担当から始める', async () => {
  menus.mockResolvedValue({ menus: [{ id: 'chosen', name: '相談' } as MenuItem] });
  open(); expect(await screen.findByText('担当選択:相談')).toBeTruthy();
});
test('削除・非公開の指定は通常のメニュー選択へ戻す', async () => {
  menus.mockResolvedValue({ menus: [] }); open();
  await waitFor(() => expect(menus).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'メニュー一覧' })).toBeTruthy();
  expect(screen.queryByText(/担当選択:/)).toBeNull();
});
test('指定のない入口はメニューを勝手に選ばない', () => {
  open(''); expect(menus).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'メニュー一覧' })).toBeTruthy();
});
test('URLの取得中に手で選んだメニューを後から上書きしない', async () => {
  let resolve!: (value: { menus: MenuItem[] }) => void;
  menus.mockReturnValue(new Promise(r => { resolve = r; })); open();
  fireEvent.click(screen.getByRole('button', { name: 'メニュー一覧' }));
  resolve({ menus: [{ id: 'chosen', name: '相談' } as MenuItem] });
  await waitFor(() => expect(menus).toHaveBeenCalled());
  expect(screen.queryByText('担当選択:相談')).toBeNull();
});
