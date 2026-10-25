// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Booking from './booking.js';
import { api } from '../lib/api.js';

vi.mock('../components/repeat-card.js', () => ({ default: () => null }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../lib/api.js', () => ({ api: {
  menus: vi.fn(), staffOf: vi.fn(), addons: vi.fn().mockResolvedValue([]), storePhotos: vi.fn().mockResolvedValue([]),
  bookingSettings: vi.fn().mockResolvedValue({}), customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: {} } }),
  liffConfig: vi.fn().mockResolvedValue({ data: {} }),
} }));
vi.mock('../lib/user-message.js', async original => ({ ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const menu = { id: 'menu', name: '相談', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 1000, sort_order: 0 };
const staff = { id: 'staff', display_name: '担当A', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 1000, duration_minutes: 60 };

it('読込・失敗の間は進む帯を隠し、回復して選ぶと次の段の中身を新しく描く', async () => {
  let fail!: (error: unknown) => void;
  vi.mocked(api.menus).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue({ menus: [menu] });
  let loadStaff!: (response: { staff: typeof staff[] }) => void;
  vi.mocked(api.staffOf).mockImplementation(() => new Promise(resolve => { loadStaff = resolve; }));
  render(<MemoryRouter><Booking /></MemoryRouter>);
  expect(screen.queryByRole('button', { name: '担当を選ぶ' })).toBeNull();
  await act(async () => { fail(new Error('offline')); });
  expect(screen.queryByRole('button', { name: '担当を選ぶ' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }));
  const choice = await screen.findByRole('button', { name: /相談/ });
  const previous = choice.closest('.liff-step');
  expect(previous).toBeTruthy();
  fireEvent.click(choice);
  fireEvent.click(await screen.findByRole('button', { name: '担当を選ぶ' }));
  expect(screen.queryByRole('button', { name: '日時を選ぶ' })).toBeNull();
  await act(async () => { loadStaff({ staff: [staff] }); });
  const person = await screen.findByRole('button', { name: /担当A/ });
  expect(person.closest('.liff-step')).not.toBe(previous);
  fireEvent.click(person);
  expect((screen.getByRole('button', { name: '日時を選ぶ' }) as HTMLButtonElement).disabled).toBe(false);
});
