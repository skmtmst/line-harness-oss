// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EventWaitlistOffer from './event-waitlist-offer.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: {
  eventWaitlistOffer: vi.fn(), acceptEventWaitlistOffer: vi.fn(),
  customerLook: vi.fn().mockResolvedValue({ success:true, data:{settings:{}} }),
  liffConfig: vi.fn().mockResolvedValue({ success:true, data:{} }),
} }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../lib/user-message.js', async original => ({ ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const detail = { waitlistId:'w', eventId:'e', slotId:'s', eventName:'見本の体験会', venueName:'見本の会場',
  startsAt:'2030-11-20T01:00:00Z', endsAt:'2030-11-20T02:00:00Z', partySize:2, status:'offered',
  expiresAt:'2030-11-01T01:00:00Z', remainingSeconds:125, canAccept:true };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2030-11-01T00:00:00Z')); vi.mocked(api.eventWaitlistOffer).mockResolvedValue({success:true,data:detail}); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
it('表示した時点から残り時間が進み、ゼロで保持を約束しない', async () => {
  await act(async () => { render(<MemoryRouter><EventWaitlistOffer token="offer" /></MemoryRouter>); });
  expect(screen.getByText('あと 2分 取っておきます')).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(60000); });
  expect(screen.getByText('あと 1分 取っておきます')).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(60000); });
  expect(screen.getByText('あと 5秒 取っておきます')).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.queryByText(/取っておきます/)).toBeNull();
  expect(screen.getByText(/回答期限を確認してください/)).toBeTruthy();
  expect(api.acceptEventWaitlistOffer).not.toHaveBeenCalled();
});
it('画面に戻った時は経過時間を反映し、時計が戻っても時間を増やさない', async () => {
  await act(async () => { render(<MemoryRouter><EventWaitlistOffer token="offer" /></MemoryRouter>); });
  await act(async () => { vi.setSystemTime(new Date('2030-11-01T00:02:00Z')); window.dispatchEvent(new Event('focus')); });
  expect(screen.getByText('あと 5秒 取っておきます')).toBeTruthy();
  await act(async () => { vi.setSystemTime(new Date('2030-11-01T00:01:00Z')); window.dispatchEvent(new Event('focus')); });
  expect(screen.getByText('あと 5秒 取っておきます')).toBeTruthy();
});
