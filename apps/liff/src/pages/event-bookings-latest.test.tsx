// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import EventBookings from './event-bookings.js';
const read = vi.hoisted(() => vi.fn());
vi.mock('../lib/api.js', () => ({ api: { myEventBookings: read } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

test('OPSSET-02の仲間: 履歴の再試行を続けて押しても古い結果は戻らない', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  read.mockRejectedValueOnce(new Error('通信失敗'));
  render(<MemoryRouter><EventBookings /></MemoryRouter>);
  const retry = await screen.findByRole('button', { name: 'もう一度読み込む' });
  let first!: (r: { items: unknown[] }) => void;
  let last!: (r: { items: unknown[] }) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { last = resolve; }));
  act(() => { fireEvent.click(retry); fireEvent.click(retry); });
  expect(read).toHaveBeenCalledTimes(3);
  await act(async () => last({ items: [] }));
  expect(screen.getByText('これからのイベントはありません')).toBeTruthy();
  await act(async () => first({ items: [{ id: 'old', event_id: 'old', event_name: '古い結果', status: 'confirmed', slot_starts_at: '2030-10-20T10:00:00Z', slot_ends_at: '2030-10-20T11:00:00Z' }] }));
  expect(screen.queryByText('古い結果')).toBeNull();
});
