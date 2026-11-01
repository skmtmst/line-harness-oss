// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import EventConfirm from './event-confirm.js';
import { api, type EventDetail, type EventSlot } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: {
  getEvent: vi.fn(), getEventSlots: vi.fn(), createEventBooking: vi.fn(),
  customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: {} } }),
  liffConfig: vi.fn().mockResolvedValue({ data: {} }),
} }));
vi.mock('../lib/user-message.js', async original => ({ ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const detail = { id: 'e', name: '交流会', requires_approval: 0, cancel_deadline_hours_before: null, waitlist_enabled: 1 } as EventDetail;
const slot: EventSlot = { id: 's', event_id: 'e', starts_at: '2099-10-20T01:00:00Z', ends_at: '2099-10-20T02:00:00Z', capacity: 5, is_active: 1, active_count: 3, remaining: 2 };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
beforeEach(() => {
  vi.mocked(api.getEvent).mockResolvedValue(detail);
  vi.mocked(api.getEventSlots).mockResolvedValue({ items: [slot] });
});
function Destination() { const location = useLocation(); return <p data-testid="destination">{location.pathname + location.search}</p>; }
function Switch() { const navigate = useNavigate(); return <><button onClick={() => navigate('/events/e/confirm?slotId=other&liffId=account')}>別の枠</button><button onClick={() => navigate('/events/e/confirm?slotId=s&liffId=account')}>元の枠</button></>; }
function open() {
  render(<MemoryRouter initialEntries={['/events/e/confirm?slotId=s&liffId=account&remaining=999']}><Routes>
    <Route path="/events/:id/confirm" element={<><Switch /><EventConfirm /></>} />
    <Route path="/events/:id/done" element={<Destination />} />
  </Routes></MemoryRouter>);
}
function value() { return screen.getByText('枠全体の空き（確認時点）').parentElement!.querySelector('dd')!.textContent; }

it.each([
  [5, 2, 1, '残り 2 席'],
  [5, 0, 1, '満席・キャンセル待ちの受付あり'],
  [5, 0, 0, '満席'],
  [null, null, 1, '枠全体の定員なし'],
  [null, 3, 1, '枠全体の定員なし'],
  [5, 2.5, 1, '確認できません'],
  [5, null, 1, '確認できません'],
  [5, undefined, 1, '確認できません'],
  [undefined, null, 1, '確認できません'],
  [5, -1, 1, '確認できません'],
  [5, 6, 1, '確認できません'],
] as const)('確認GETの定員%s・残席%s・待ち%sを全体の値として示す', async (capacity, remaining, waiting, expected) => {
  vi.mocked(api.getEvent).mockResolvedValue({ ...detail, waitlist_enabled: waiting });
  vi.mocked(api.getEventSlots).mockResolvedValue({ items: [{ ...slot, capacity, remaining } as EventSlot] });
  open();
  await screen.findByRole('button', { name: '申し込む' });
  expect(value()).toBe(expected);
  expect(screen.getByText(/空きは確保されていません。受付結果は送信時の空き状況で決まります。/)).toBeTruthy();
  expect(Boolean(screen.queryByText(/キャンセル待ちになる場合があります。/))).toBe(waiting === 1);
  expect(screen.getByRole('button', { name: '申し込む' })).not.toHaveProperty('disabled', true);
  expect(api.createEventBooking).not.toHaveBeenCalled();
});

it('未取得と失敗は空きの事実を出さず、再試行で確認した値を出す', async () => {
  vi.mocked(api.getEventSlots).mockRejectedValueOnce(new Error('offline'));
  open();
  expect(screen.queryByText('枠全体の空き（確認時点）')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }));
  await screen.findByRole('button', { name: '申し込む' });
  expect(value()).toBe('残り 2 席');
  expect(api.getEventSlots).toHaveBeenCalledTimes(2);
});

it('別枠の再取得中に以前の空きを断定せず、遅れて届く以前の応答も捨てる', async () => {
  let resolve!: (value: { items: EventSlot[] }) => void;
  const pending = new Promise<{ items: EventSlot[] }>(done => { resolve = done; });
  vi.mocked(api.getEventSlots).mockReturnValueOnce(pending).mockResolvedValueOnce({ items: [{ ...slot, id: 'other', remaining: 0 }] });
  open();
  fireEvent.click(screen.getByRole('button', { name: '別の枠' }));
  await screen.findByText('満席・キャンセル待ちの受付あり');
  await act(async () => { resolve({ items: [slot] }); await pending; });
  expect(value()).toBe('満席・キャンセル待ちの受付あり');
  expect(screen.queryByText('残り 2 席')).toBeNull();
});

it('表示済みの枠から別枠へ移った直後は確認中を示し、新しいGET値に更新する', async () => {
  let resolve!: (value: { items: EventSlot[] }) => void;
  const pending = new Promise<{ items: EventSlot[] }>(done => { resolve = done; });
  vi.mocked(api.getEventSlots).mockResolvedValueOnce({ items: [slot] }).mockReturnValueOnce(pending);
  open();
  await screen.findByText('残り 2 席');
  fireEvent.click(screen.getByRole('button', { name: '別の枠' }));
  expect(value()).toBe('確認しています');
  await act(async () => { resolve({ items: [{ ...slot, id: 'other', remaining: 0 }] }); await pending; });
  expect(value()).toBe('満席・キャンセル待ちの受付あり');
});

it.each([true, false])('表示の空きに依存せず送信結果の待ち=%sで完了へ進む', async waiting => {
  vi.mocked(api.getEventSlots).mockResolvedValue({ items: [{ ...slot, remaining: waiting ? 2 : 0 }] });
  vi.mocked(api.createEventBooking).mockResolvedValue(waiting ? { waitlisted: true, slot_id: 's' } : { id: 'booking', status: 'confirmed' });
  open();
  fireEvent.click(await screen.findByRole('button', { name: '申し込む' }));
  const url = new URL((await screen.findByTestId('destination')).textContent!, 'https://example.test');
  expect(url.searchParams.get('status')).toBe(waiting ? 'waitlisted' : 'confirmed');
  expect(url.searchParams.get('liffId')).toBe('account');
  expect(api.createEventBooking).toHaveBeenCalledWith('e', { slot_id: 's', customer_note: null }, expect.any(String));
});

it('元の枠へ戻っても以前の空きを確認済みとして再利用しない', async () => {
  let resolve!: (value: { items: EventSlot[] }) => void;
  const pending = new Promise<{ items: EventSlot[] }>(done => { resolve = done; });
  vi.mocked(api.getEventSlots).mockResolvedValueOnce({ items: [slot] })
    .mockReturnValueOnce(new Promise(() => {})).mockReturnValueOnce(pending);
  open();
  await screen.findByText('残り 2 席');
  fireEvent.click(screen.getByRole('button', { name: '別の枠' }));
  expect(value()).toBe('確認しています');
  fireEvent.click(screen.getByRole('button', { name: '元の枠' }));
  expect(value()).toBe('確認しています');
  await act(async () => { resolve({ items: [{ ...slot, remaining: 0 }] }); await pending; });
  expect(value()).toBe('満席・キャンセル待ちの受付あり');
});
