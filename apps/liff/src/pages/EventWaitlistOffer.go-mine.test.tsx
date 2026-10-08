// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import EventWaitlistOffer, { searchWithoutOfferToken } from './EventWaitlistOffer.js';

/**
 * 監査 L2：繰上げ案内（?eventWaitlistToken=…）から「自分のイベントを見る」で
 * 移るとき、案内の token を外す。残すと App が案内の画面を優先して戻ってくる。
 */

vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../lib/api.js', () => ({
  api: {
    eventWaitlistOffer: vi.fn().mockRejectedValue(new Error('offline')),
    acceptEventWaitlistOffer: vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { status: 410 })),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    bookingSettings: vi.fn().mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 }),
  },
}));
vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

function Probe() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

afterEach(() => cleanup());

describe('監査 L2：自分のイベントへ移るときは案内の token を外す', () => {
  it('ほかの値は残し、eventWaitlistToken だけ外す', () => {
    expect(searchWithoutOfferToken('?eventWaitlistToken=t1&liffId=L1')).toBe('?liffId=L1');
    expect(searchWithoutOfferToken('?eventWaitlistToken=t1')).toBe('');
  });

  it('期限切れの案内から「自分のイベントを見る」で /events/me へ token なしで移る', async () => {
    render(
      <MemoryRouter initialEntries={['/?eventWaitlistToken=t1&liffId=L1']}>
        <Routes>
          <Route path="/" element={<EventWaitlistOffer token="t1" />} />
          <Route path="/events/me" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    const take = await screen.findAllByRole('button', { name: /席を取る|予約する|承諾/ });
    fireEvent.click(take[0]);
    fireEvent.click(await screen.findByRole('button', { name: '自分のイベントを見る' }));
    const where = (await screen.findByTestId('where')).textContent ?? '';
    expect(where).toBe('/events/me?liffId=L1');
    expect(where).not.toContain('eventWaitlistToken');
  });
});
