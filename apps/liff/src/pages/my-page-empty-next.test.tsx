// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MyPage from './my-page.js';
import { CustomerStyleContext } from '../components/customer-style-scope.js';
import type { CustomerStyle } from '../lib/customer-style.js';
import { api } from '../lib/api.js';
import { affiliateSelfApi } from '../lib/affiliate-self-api.js';

vi.mock('../lib/api.js', () => ({ api: {
  me: vi.fn(), menus: vi.fn().mockResolvedValue({ menus: [] }), bookingPaymentStatus: vi.fn().mockResolvedValue({ payment: null }),
  bookingWaitlists: vi.fn().mockResolvedValue({ waitlist: [] }), entitlements: vi.fn().mockResolvedValue([]),
  liffConfig: vi.fn().mockResolvedValue({ success: true, data: { accountId: 'store', accountName: '人工店', botBasicId: '' } }),
  notificationPreferences: vi.fn().mockResolvedValue({ purposeSpecificEnforcement: false, items: [] }),
  updateNotificationPreference: vi.fn(), startBookingPayment: vi.fn(),
}, visitStampsApi: { cards: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../lib/affiliate-self-api.js', () => ({ affiliateSelfApi: { rewards: vi.fn().mockResolvedValue({ rewards: [], availableMiles: 20, balanceSource: 'musubo' }) } }));
vi.mock('../lib/liff-runtime.js', () => ({ default: { getProfile: async () => ({ displayName: '人工会員' }) } }));
vi.mock('../lib/user-message.js', async original => ({ ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
beforeEach(() => { vi.mocked(api.me).mockReset().mockResolvedValue({ upcoming: [], past: [] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function CurrentUrl() { const location = useLocation(); return <p data-testid="url">{location.pathname + location.search}</p>; }
function open(style: CustomerStyle) {
  render(<MemoryRouter initialEntries={['/mypage?liffId=store&from=profile']}><CustomerStyleContext.Provider value={style}><MyPage /><CurrentUrl /></CustomerStyleContext.Provider></MemoryRouter>);
}
it('ECの残高をマイページに表示する', async () => {
  vi.mocked(affiliateSelfApi.rewards).mockResolvedValueOnce({ rewards: [], availableMiles: 29, balanceSource: 'ec' });
  open('ec');
  expect(await screen.findByText('29')).toBeTruthy();
});
it('EC残高未取得は0ではなく未取得の表示を使う', async () => {
  vi.mocked(affiliateSelfApi.rewards).mockResolvedValueOnce({ rewards: [], availableMiles: null, balanceSource: 'ec' });
  open('ec');
  const row = (await screen.findByText('マイル')).closest('li');
  expect(row?.textContent).toContain('—');
});
it.each(['standard', 'salon', 'restaurant', 'consult', 'lesson', 'ec'] as const)('予約なしの%sで既存の案内と予約操作の有無を保つ', async style => {
  open(style);
  await screen.findByText('お知らせごとの受け取りの設定は現在準備中です。');
  const message = screen.queryByText('次の予約はありません');
  if (style === 'ec') {
    expect(message).toBeNull();
    expect(screen.queryByRole('button', { name: '予約する' })).toBeNull();
  } else {
    expect(message).toBeTruthy();
    const card = message!.closest('[data-liff-card]') as HTMLElement;
    if (style === 'lesson') expect(within(card).queryByRole('button', { name: '予約する' })).toBeNull();
    else {
      fireEvent.click(within(card).getByRole('button', { name: '予約する' }));
      expect(screen.getByTestId('url').textContent).toBe('/booking?liffId=store&from=profile');
    }
  }
  expect(api.startBookingPayment).not.toHaveBeenCalled();
  expect(api.updateNotificationPreference).not.toHaveBeenCalled();
});
it('履歴の取得失敗を予約なしと誤表示しない', async () => {
  vi.mocked(api.me).mockRejectedValueOnce(new Error('offline'));
  open('salon');
  await screen.findByRole('button', { name: 'もう一度読み込む' });
  expect(screen.queryByText('次の予約はありません')).toBeNull();
  expect(screen.queryByRole('button', { name: '予約する' })).toBeNull();
  expect(api.startBookingPayment).not.toHaveBeenCalled();
});
it('予約があれば空の案内を出さず、既存の予約詳細へ進む', async () => {
  vi.mocked(api.me).mockResolvedValue({ upcoming: [{ id: 'booking', starts_at: '2099-01-01T00:00:00Z', status: 'confirmed', menu_name: '人工面談', staff_name: '人工担当', profile_image_url: null, menu_id: 'm', staff_id: 's', lock_version: 1, cancel_deadline_at: '2098-12-31T00:00:00Z' }], past: [] });
  open('salon');
  fireEvent.click(await screen.findByRole('button', { name: '予約の詳細' }));
  expect(screen.queryByText('次の予約はありません')).toBeNull();
  expect(screen.getByTestId('url').textContent).toBe('/booking/history?liffId=store&from=profile');
  expect(api.startBookingPayment).not.toHaveBeenCalled();
});
