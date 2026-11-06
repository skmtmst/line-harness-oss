// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import EventWaitlistOffer from './event-waitlist-offer.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: {
  eventWaitlistOffer: vi.fn().mockResolvedValue({ data: { waitlistId: 'w', eventId: 'e', slotId: 's', partySize: 2, status: 'offered', expiresAt: '2030-11-01T01:00:00Z', eventName: '見本のイベント', startsAt: '2030-11-20T01:00:00Z', endsAt: '2030-11-20T02:00:00Z', venueName: null, remainingSeconds: 3600, canAccept: true } }), acceptEventWaitlistOffer: vi.fn(),
  customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: {} } }), liffConfig: vi.fn().mockResolvedValue({ data: {} }),
} }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../lib/user-message.js', async original => ({ ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([[200, '予約が確定しました'], [410, '回答期限を過ぎています'], [404, 'この案内は使えませんでした'], [409, 'この案内は使えませんでした']])('承諾の状態%sを別の案内で表示する', async (status, message) => {
  if (status === 200) vi.mocked(api.acceptEventWaitlistOffer).mockResolvedValueOnce({ success: true, data: { bookingId: 'booking', status: 'confirmed', alreadyConfirmed: false } });
  else vi.mocked(api.acceptEventWaitlistOffer).mockRejectedValueOnce({ status });
  render(<MemoryRouter><EventWaitlistOffer token="offer/token" /></MemoryRouter>);
  expect(api.acceptEventWaitlistOffer).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'この席を取る' }));
  expect(await screen.findByText(message)).toBeTruthy();
  expect(api.acceptEventWaitlistOffer).toHaveBeenCalledExactlyOnceWith('offer/token');
});

it('送信中の連打を止め、通信失敗なら同じ案内でやり直せる', async () => {
  let reject!: (error: unknown) => void;
  vi.mocked(api.acceptEventWaitlistOffer).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce({ success: true, data: { bookingId: 'booking', status: 'confirmed', alreadyConfirmed: false } });
  render(<MemoryRouter><EventWaitlistOffer token="offer" /></MemoryRouter>);
  const take = await screen.findByRole('button', { name: 'この席を取る' });
  fireEvent.click(take); fireEvent.click(take);
  expect(api.acceptEventWaitlistOffer).toHaveBeenCalledTimes(1);
  reject(new Error('offline'));
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度試す' }));
  expect(await screen.findByText('予約が確定しました')).toBeTruthy();
  expect(api.acceptEventWaitlistOffer).toHaveBeenNthCalledWith(2, 'offer');
});
