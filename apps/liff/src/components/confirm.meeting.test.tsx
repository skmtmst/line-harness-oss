// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Confirm from './confirm.js';
import { CustomerStyleContext } from './customer-style-scope.js';
import { api, type MenuItem } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { cancellationPreview: vi.fn(), entitlements: vi.fn(), createRequest: vi.fn() } }));
const menu: MenuItem = { id: 'm', name: '個別相談', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 0, sort_order: 0 };
const staff = { id: 's', display_name: '担当A', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 0, duration_minutes: 60 };
beforeEach(() => {
  vi.mocked(api.cancellationPreview).mockResolvedValue({ enabled: false } as never);
  vi.mocked(api.entitlements).mockResolvedValue([]);
  vi.mocked(api.createRequest).mockResolvedValue({ booking_id: 'b', status: 'requested' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const mount = (mode?: MenuItem['meeting_mode']) => render(<CustomerStyleContext.Provider value="consult">
  <Confirm menu={{ ...menu, meeting_mode: mode }} staff={staff} slot={{ date: '2099-01-01', start: '10:00' }} autoConfirm={false} onSubmitted={() => {}} />
</CustomerStyleContext.Provider>);

it.each(['online', 'in_person'] as const)('会い方 %s を選ぶまで送れず、同じ予約の値として送る', async (mode) => {
  mount('customer_choice');
  const submit = screen.getByRole('button', { name: /予約をリクエスト/ });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: mode === 'online' ? 'オンライン' : '対面' }));
  await vi.waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);
  await vi.waitFor(() => expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({ menu_id: 'm', staff_id: 's', meeting_mode: mode }), expect.any(String)));
  expect(screen.queryByText(/ご来店/)).toBeNull();
});

it.each(['online', 'in_person'] as const)('メニュー固定の %s を選び直させず表示・送信する', async (mode) => {
  mount(mode);
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByText(mode === 'online' ? 'オンライン' : '対面')).toBeTruthy();
  const submit = screen.getByRole('button', { name: /予約をリクエスト/ });
  await vi.waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);
  await vi.waitFor(() => expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({ meeting_mode: mode }), expect.any(String)));
});

it('会い方の読取値が無いと対面で代用せず停止する', async () => {
  mount();
  await screen.findByText(/会い方を読み込めませんでした/);
  fireEvent.click(screen.getByRole('button', { name: /予約をリクエスト/ }));
  expect(api.createRequest).not.toHaveBeenCalled();
});
