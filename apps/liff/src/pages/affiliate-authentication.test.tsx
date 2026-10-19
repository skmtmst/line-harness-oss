// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Affiliate from './affiliate.js';

vi.mock('@line/liff', () => ({ default: { getAccessToken: () => 'private-fixture-token' } }));
vi.mock('../components/member-card.js', () => ({ default: () => null }));
vi.mock('../components/mileage-rewards.js', () => ({ default: () => null }));
vi.mock('../components/affiliate-payments.js', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('F02: プロフィール・案件・残高の全GETは本人のBearerのみを送り、業務queryを保つ', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    const body = path.endsWith('/affiliate/me')
      ? { affiliate: { id: 'a', name: '人工会員', code: 'abc', isActive: true, friendId: 'f', commissionRate: 0 }, links: [] }
      : path.endsWith('/affiliate/offers') ? { offers: [] }
      : path.endsWith('/mileage/me') ? { mileage: { programName: '人工マイル', available: 0, pending: 0, lifetimeEarned: 0, spent: 0 }, insights: { accountCount: 1, referralMiles: 0, rewardedActions: 0, qualityReferralCount: 0, lastEarnedAt: null }, opportunities: [], history: [] }
      : { success: true, data: { settings: {} } };
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<Affiliate />);
  await screen.findByText('現在参加できる案件はありません');
  const calls = fetcher.mock.calls as unknown as [URL, RequestInit][];
  const own = calls.filter(([url]) => /\/(affiliate\/(me|offers)|mileage\/me)$/.test(url.pathname));
  expect(own).toHaveLength(3);
  for (const [url, init] of own) {
    expect(String(url)).not.toContain('private-fixture-token');
    expect(url.searchParams.has('lineAccessToken')).toBe(false);
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer private-fixture-token' }, cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
  }
  expect(own.find(([url]) => url.pathname.endsWith('/mileage/me'))?.[0].searchParams.get('limit')).toBe('20');
});
