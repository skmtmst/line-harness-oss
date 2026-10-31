// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CustomerStyleContext } from './customer-style-scope.js';
import LessonHistorySection from './lesson-history-section.js';
import EventBookings from '../pages/event-bookings.js';
import { api, type EventBookingMine } from '../lib/api.js';
vi.mock('../lib/liff-auth.js', () => ({ getLiffId: () => 'qa', getLineUserId: () => 'qa' }));
vi.mock('../lib/api.js', () => ({ api: { myEventBookings: vi.fn(), makeupCredits: vi.fn(), eventAbsence: vi.fn(), customerLook: vi.fn(), liffConfig: vi.fn() } }));
const booking = { id: 'last-lesson', status: 'confirmed', event_id: 'class', event_name: '朝のヨガ', slot_starts_at: '2099-11-20T01:00:00Z', slot_ends_at: '2099-11-20T02:00:00Z', makeup: { enabled: true, cutoff_at: '2099-11-19T22:00:00Z' } } as EventBookingMine;
beforeEach(() => {
  vi.mocked(api.makeupCredits).mockResolvedValue({ credits: [] });
  vi.mocked(api.customerLook).mockRejectedValue(new Error('look unavailable'));
  vi.mocked(api.liffConfig).mockResolvedValue({ success: true, data: { accountId: 'qa', accountName: '教室', botBasicId: '@qa', style: 'lesson' } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each([['予約履歴', LessonHistorySection], ['教室の予約一覧', EventBookings]] as const)('%sで最後のレッスンを欠席しても、読み直し後に上限の案内が残る', async (_name, Component) => {
  let absent = false;
  vi.mocked(api.myEventBookings).mockImplementation(async tab => ({ items: !absent && tab === 'upcoming' ? [booking] : [] }));
  vi.mocked(api.eventAbsence).mockImplementation(async () => { absent = true; return { credit: null, reason_if_none: 'monthly_cap' }; });
  render(<MemoryRouter><CustomerStyleContext.Provider value="lesson"><Component /></CustomerStyleContext.Provider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '欠席する' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '欠席する' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(screen.queryByRole('button', { name: '欠席する' })).toBeNull());
  const notice = screen.getByRole('status');
  expect(notice.textContent).toContain('今月の振替の上限に達しています。欠席は受け付けました。');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(api.eventAbsence).toHaveBeenCalledTimes(1);
});
