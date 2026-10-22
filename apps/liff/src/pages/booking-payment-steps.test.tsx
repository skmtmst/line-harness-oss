// @vitest-environment happy-dom
import { useEffect, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import Booking from './booking.js';
import type { MenuItem, StaffItem } from '../lib/api.js';
const fixture = vi.hoisted(() => ({ payment: true }));
vi.mock('../lib/api.js', () => ({ api: { menus: async () => ({ menus: [{ id: 'm', name: 'メニュー' }] }), bookingSettings: async () => ({}), storePhotos: async () => [] } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
vi.mock('../components/repeat-card.js', () => ({ default: () => null }));
vi.mock('../components/menu-list.js', () => ({ default: function MenuListMock({ onSelect, onLoadState }: { onSelect: (m: MenuItem) => void; onLoadState: (ready: boolean) => void }) {
  useEffect(() => { void Promise.resolve().then(() => onLoadState(true)); }, [onLoadState]);
  return <button onClick={() => onSelect({ id: 'm', name: 'メニュー' } as MenuItem)}>選ぶメニュー</button>;
} }));
vi.mock('../components/staff-list.js', () => ({ default: function StaffListMock({ onSelect, onLoadState }: { onSelect: (s: StaffItem) => void; onLoadState: (ready: boolean) => void }) {
  useEffect(() => { void Promise.resolve().then(() => onLoadState(true)); }, [onLoadState]);
  return <button onClick={() => onSelect({ id: 's', price: 1000 } as StaffItem)}>選ぶ担当</button>;
} }));
vi.mock('../components/date-time-picker.js', () => ({ default: ({ onSelect, onConfirm }: { onSelect: (s: { date: string; start: string }) => void; onConfirm: () => void }) => <><button onClick={() => onSelect({ date: '2030-10-20', start: '10:00' })}>選ぶ日時</button><button onClick={onConfirm}>内容を見る</button></> }));
vi.mock('../components/confirm.js', () => ({ default: ({ onSubmitted, onPaymentChange }: { onSubmitted: (r: unknown) => void; onPaymentChange?: (online: boolean) => void }) => <>
  <button onClick={() => onPaymentChange?.(true)}>人工の先払い選択</button><button onClick={() => onPaymentChange?.(false)}>人工の店頭選択</button>
  <button onClick={() => onSubmitted({ bookingId: 'b', status: 'confirmed', payment: fixture.payment ? { id: 'p', status: 'unpaid' } : null, prepayNotice: null })}>人工データで受付</button>
</> }));
// 決済への接続は一切動かさず、親の本物の手順帯だけを調べる。
vi.mock('../components/booking-payment.js', () => ({ default: () => <p>お支払いの画面</p> }));
vi.mock('../components/done.js', () => ({ default: () => <p>受付完了</p> }));
afterEach(cleanup);
test.each([true, false])('REM3-03: 支払いあり=%s の手順帯は実際の段を選ぶ', async payment => {
  fixture.payment = payment;
  render(<MemoryRouter initialEntries={['/booking']}><Booking /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '選ぶメニュー' }));
  fireEvent.click(await screen.findByRole('button', { name: '担当を選ぶ' }));
  fireEvent.click(await screen.findByRole('button', { name: '選ぶ担当' }));
  fireEvent.click(await screen.findByRole('button', { name: '日時を選ぶ' }));
  fireEvent.click(screen.getByRole('button', { name: '選ぶ日時' }));
  fireEvent.click(screen.getByRole('button', { name: '内容を見る' }));
  expect(within(screen.getByRole('list', { name: '予約の手順' })).getAllByRole('listitem')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: '人工の先払い選択' }));
  expect(within(screen.getByRole('list', { name: '予約の手順' })).getAllByRole('listitem')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: '人工の店頭選択' }));
  expect(within(screen.getByRole('list', { name: '予約の手順' })).getAllByRole('listitem')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: '人工データで受付' }));
  if (payment) {
    expect(within(screen.getByRole('list', { name: '予約の手順' })).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('5 お支払い').getAttribute('aria-current')).toBe('step');
  } else {
    expect(screen.getByText('受付完了')).toBeTruthy();
    expect(screen.queryByText('5 お支払い')).toBeNull();
  }
});
