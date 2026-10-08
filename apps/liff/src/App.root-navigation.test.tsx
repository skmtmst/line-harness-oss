// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App.js';

vi.mock('./pages/Booking.js', () => ({ default: function BookingProbe() {
  const location = useLocation();
  return <p data-testid="booking-url">{location.pathname + location.search}</p>;
} }));
vi.mock('./pages/EventWaitlistOffer.js', () => ({ default: ({ token }: { token: string }) => <p>案内:{token}</p> }));
vi.mock('@line/liff', () => ({ default: {
  init: vi.fn(), isLoggedIn: () => true, getProfile: async () => ({ userId: 'test-user' }), getIDToken: () => 'test-token',
} }));

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('L13：入口の移動と再読込で liffId を保つ', () => {
  it.each(['?liffId=account-B&ref=link-1&context=a%2Fb', ''])('入口の検索指定をそのまま予約へ渡す (%s)', async (search) => {
    render(<MemoryRouter initialEntries={[`/${search}`]}><App /></MemoryRouter>);
    expect((await screen.findByTestId('booking-url')).textContent).toBe(`/booking${search}`);
  });

  it('環境の既定が別の口座でも、移動後の再初期化で明示した口座を使う', async () => {
    vi.stubEnv('VITE_DEFAULT_LIFF_ID', 'account-A');
    window.history.replaceState(null, '', '/?liffId=account-B');
    vi.resetModules();
    const firstAuth = await import('./lib/liff-auth.js');
    await firstAuth.initLiff();
    expect(firstAuth.getLiffId()).toBe('account-B');
    render(<MemoryRouter initialEntries={['/?liffId=account-B']}><App /></MemoryRouter>);
    const next = (await screen.findByTestId('booking-url')).textContent!;
    window.history.replaceState(null, '', next);
    vi.resetModules();
    const reloadedAuth = await import('./lib/liff-auth.js');
    await reloadedAuth.initLiff();
    expect(reloadedAuth.getLiffId()).toBe('account-B');
  });

  it('繰上げ案内の token がある入口は引き続き案内を優先する', async () => {
    render(<MemoryRouter initialEntries={['/?liffId=account-B&eventWaitlistToken=offer-1']}><App /></MemoryRouter>);
    expect(await screen.findByText('案内:offer-1')).toBeTruthy();
    expect(screen.queryByTestId('booking-url')).toBeNull();
  });
});
