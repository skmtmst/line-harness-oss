// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Done from './Done.js';

/**
 * 完了画面の「事前のお支払いのお願い」(booking-plus 8)。
 * 無断キャンセルが続いている人だけ案内と支払いへのボタンが出る。
 * 決済の用意が無い店では電話での確認に案内する。
 */

vi.mock('react-router-dom', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useLocation: () => ({ search: '' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
vi.mock('../lib/api.js', () => ({
  api: { startBookingPayment: vi.fn() },
}));

const startBookingPayment = vi.mocked(api.startBookingPayment);

const SLOT = { date: '2026-10-20', start: '10:00' };

beforeEach(() => {
  startBookingPayment.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Done の事前のお支払い', () => {
  it('案内が無いときは何も出さない', () => {
    render(<Done menuName="カット" slot={SLOT} durationMinutes={60} />);
    expect(screen.queryByText('事前のお支払いをお願いしています')).toBeNull();
    expect(screen.queryByRole('button', { name: 'お支払いへ進む' })).toBeNull();
  });

  it('案内があるとき文とボタンが出て、押すと支払いを始める', async () => {
    startBookingPayment.mockResolvedValue({ payment: null, checkoutUrl: 'https://pay.example.com/s/1' });
    const originalHref = window.location.href;
    render(
      <Done
        menuName="カット"
        slot={SLOT}
        durationMinutes={60}
        bookingId="b1"
        prepayNotice="無断キャンセルが続いているため、この予約は前払いのみです。"
      />,
    );

    expect(screen.getByText('事前のお支払いをお願いしています')).toBeTruthy();
    expect(screen.getByText('無断キャンセルが続いているため、この予約は前払いのみです。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'お支払いへ進む' }));
    await waitFor(() => expect(startBookingPayment).toHaveBeenCalledWith('b1'));
    window.location.href = originalHref;
  });

  it('決済の用意が無い店では電話での確認に案内する', async () => {
    startBookingPayment.mockResolvedValue({ payment: null, checkoutUrl: null });
    render(
      <Done
        menuName="カット"
        slot={SLOT}
        durationMinutes={60}
        bookingId="b1"
        prepayNotice="無断キャンセルが続いているため、この予約は前払いのみです。"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'お支払いへ進む' }));
    expect(
      await screen.findByText('このお店ではアプリでのお支払いができません。お手数ですが、お店に電話で確認してください。'),
    ).toBeTruthy();
  });
});
