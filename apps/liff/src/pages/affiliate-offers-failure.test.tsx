// @vitest-environment happy-dom
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { setLiffContext } from '../lib/liff-auth.js';
import Affiliate from './affiliate.js';
import { mountAffiliate, unmountAffiliate } from '../../../worker/src/client/affiliate/main.js';
vi.mock('@line/liff', () => ({ default: { getAccessToken: () => 'fixture' } }));
vi.mock('../components/mileage-rewards.js', () => ({ default: () => null }));
vi.mock('../components/affiliate-payments.js', () => ({ default: () => null }));
let failed = true;
afterEach(async () => { await act(async () => unmountAffiliate()); cleanup(); vi.unstubAllGlobals(); });
test.each([['worker', false], ['liff', false], ['worker', true], ['liff', true]] as const)('%s・登録後%sの案件取得失敗は0件とせず再試行できる', async (entry, afterRegister) => {
  let registered = !afterRegister;
  let postCount = 0;
  setLiffContext({ liffId: 'store', lineUserId: 'friend', idToken: 'fixture' });
  failed = true; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/affiliate/me') && !registered) return new Response('{}', { status: 404 });
    if (path.endsWith('/affiliate/register')) { registered = true; postCount++; }
    const body = path.endsWith('/affiliate/register') || path.endsWith('/affiliate/me') ? { affiliate: { id: 'a', name: '人工会員', code: 'abc', isActive: true, friendId: 'f', commissionRate: 0 }, links: [] }
      : path.endsWith('/affiliate/offers') ? { offers: [] }
      : path.endsWith('/customer-look') ? { success: true, data: { settings: { liff_theme: 'night' } } }
      : { mileage: { programName: '人工ポイント', available: 0, pending: 0, lifetimeEarned: 0, spent: 0 }, insights: { accountCount: 1, referralMiles: 0, rewardedActions: 0, qualityReferralCount: 0, lastEarnedAt: null }, opportunities: [], history: [] };
    return new Response(JSON.stringify(body), { status: path.endsWith('/affiliate/offers') && failed ? 503 : 200 });
  }));
  if (entry === 'liff') render(<Affiliate />);
  else { const host = document.createElement('div'); document.body.append(host); await act(async () => mountAffiliate(host, { liffId: 'store', lineUserId: 'friend', lineAccessToken: 'fixture' })); }
  if (afterRegister) fireEvent.click(await screen.findByRole('button', { name: /紹介者になる|はじめる/ }));
  const retry = await screen.findByRole('button', { name: /もう一度読み込む|再読み込み/ });
  expect(screen.queryByText('現在参加できる案件はありません')).toBeNull();
  failed = false; fireEvent.click(retry);
  await screen.findByText('現在参加できる案件はありません');
  expect(postCount).toBe(afterRegister ? 1 : 0);
});
