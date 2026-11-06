// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MyPage from './my-page.js';
import { api, visitStampsApi, type BookingEntitlement, type NotificationPreferences } from '../lib/api.js';
import { affiliateSelfApi } from '../lib/affiliate-self-api.js';
import { LiffApiError } from '../lib/api-error.js';

vi.mock('../lib/api.js', () => ({ api: { me: vi.fn(), menus: vi.fn(), bookingWaitlists: vi.fn(), entitlements: vi.fn(), liffConfig: vi.fn(), notificationPreferences: vi.fn(), updateNotificationPreference: vi.fn() }, visitStampsApi: { cards: vi.fn() } }));
vi.mock('../lib/affiliate-self-api.js', () => ({ affiliateSelfApi: { rewards: vi.fn() } }));
vi.mock('../lib/liff-runtime.js', () => ({ default: { getProfile: async () => ({ displayName: '見本の会員' }) } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
const ticket: BookingEntitlement = { id: 'pass', name: '面談5回券', kind: 'ticket', menuId: null, remaining: 3, monthlyLimit: null, monthAllowance: null, monthUsed: null, monthRemaining: null, validFrom: null, expiresAt: null, periodStart: null, periodEnd: null, usable: true };
const prefs: NotificationPreferences = { purposeSpecificEnforcement: true, items: ['booking_reminders', 'marketing'].map((purpose) => ({ purpose: purpose as 'booking_reminders' | 'marketing', label: purpose, enabled: true, state: 'granted', recorded: true, version: 2, updatedAt: null })) };
const error = (status: number, code?: string) => new LiffApiError(status, { success: false, error: { code, message: '一時的に読み込めません。', requestId: 'qa-read', fieldErrors: [] } });
beforeEach(() => {
  vi.mocked(api.me).mockResolvedValue({ upcoming: [], past: [] });
  vi.mocked(api.bookingWaitlists).mockResolvedValue({ waitlist: [] });
  vi.mocked(api.entitlements).mockResolvedValue([ticket]);
  vi.mocked(api.liffConfig).mockResolvedValue({ success: true, data: { accountId: 'store', accountName: '見本の店', botBasicId: '' } });
  vi.mocked(api.notificationPreferences).mockResolvedValue(prefs);
  vi.mocked(visitStampsApi.cards).mockResolvedValue({ success: true, data: [] });
  vi.mocked(affiliateSelfApi.rewards).mockResolvedValue({ rewards: [], availableMiles: 20, balanceSource: 'musubo' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const mount = () => render(<MemoryRouter initialEntries={['/mypage?liffId=store']}><MyPage /></MemoryRouter>);
const failures = [
  ['汎用503', error(503, 'booking_entitlements_unavailable')],
  ['codeなし503', error(503)],
  ['友だち不明404', error(404, 'friend_not_found')],
  ['codeなし404', error(404)],
  ['404の準備code', error(404, 'booking_storage_not_ready')],
  ['本文だけ準備未了', new LiffApiError(503, { message: 'booking_storage_not_ready' })],
  ['通信失敗', new Error('offline')],
  ['接頭語なし準備code', error(503, 'storage_not_ready')],
  ['大文字準備code', error(503, 'BOOKING_STORAGE_NOT_READY')],
] as const;
it.each(failures)('回数券の%sは準備中にせず、再読込で実値へ戻る', async (_name, failure) => {
  vi.mocked(api.entitlements).mockRejectedValueOnce(failure).mockResolvedValueOnce([ticket]);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /回数券.*もう一度読み込む/ }));
  fireEvent.click(await screen.findByRole('button', { name: /回数券.*残り 3 回/ }));
  expect(await screen.findByText('面談5回券')).toBeTruthy();
  expect(api.entitlements).toHaveBeenCalledTimes(2);
  expect(api.updateNotificationPreference).not.toHaveBeenCalled();
});
it.each(failures)('通知の%sは準備中にせず、再読込で設定へ戻る', async (_name, failure) => {
  vi.mocked(api.notificationPreferences).mockRejectedValueOnce(failure).mockResolvedValueOnce(prefs);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByRole('switch', { name: 'キャンペーン・宣伝を受け取る' })).toBeTruthy();
  expect(screen.queryByRole('switch', { name: /予約/ })).toBeNull();
  expect(api.notificationPreferences).toHaveBeenCalledTimes(2);
  expect(api.updateNotificationPreference).not.toHaveBeenCalled();
});
it.each([error(501), error(503, 'booking_storage_not_ready'), error(503, 'notification_storage_not_ready')])('明示された未提供は両方とも準備中のまま', async (failure) => {
  vi.mocked(api.entitlements).mockRejectedValueOnce(failure);
  vi.mocked(api.notificationPreferences).mockRejectedValueOnce(failure);
  mount();
  expect(await screen.findByText('お知らせごとの受け取りの設定は現在準備中です。')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /回数券.*準備中/ }));
  expect(await screen.findByText('回数券は現在準備中です。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull();
  expect(api.entitlements).toHaveBeenCalledTimes(1);
  expect(api.notificationPreferences).toHaveBeenCalledTimes(1);
  expect(api.updateNotificationPreference).not.toHaveBeenCalled();
});
it.each([false, undefined])('成功しても目的別停止が%sならスイッチを出さない', async (purposeSpecificEnforcement) => {
  vi.mocked(api.notificationPreferences).mockResolvedValue({ ...prefs, purposeSpecificEnforcement });
  mount();
  expect(await screen.findByText('お知らせごとの受け取りの設定は現在準備中です。')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(api.updateNotificationPreference).not.toHaveBeenCalled();
});
