// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MyPage from './my-page.js';
import { api, visitStampsApi } from '../lib/api.js';
import { affiliateSelfApi } from '../lib/affiliate-self-api.js';

vi.mock('../lib/api.js', () => ({ api: { me: vi.fn(), menus: vi.fn(), bookingWaitlists: vi.fn(), entitlements: vi.fn(), liffConfig: vi.fn(), notificationPreferences: vi.fn(), updateNotificationPreference: vi.fn() }, visitStampsApi: { cards: vi.fn() } }));
vi.mock('../lib/affiliate-self-api.js', () => ({ affiliateSelfApi: { rewards: vi.fn() } }));
vi.mock('../lib/liff-runtime.js', () => ({ default: { getProfile: async () => ({ displayName: '人工会員' }) } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
beforeEach(() => {
  vi.mocked(api.me).mockResolvedValue({ upcoming: [], past: [] });
  vi.mocked(api.bookingWaitlists).mockResolvedValue({ waitlist: [] });
  vi.mocked(api.entitlements).mockResolvedValue([]);
  vi.mocked(api.liffConfig).mockResolvedValue({ success: true, data: { accountId: 'store', accountName: '人工教室', botBasicId: '' } });
  vi.mocked(api.notificationPreferences).mockResolvedValue({ purposeSpecificEnforcement: false, items: [] } as never);
  vi.mocked(visitStampsApi.cards).mockResolvedValue({ success: true, data: [] });
  vi.mocked(affiliateSelfApi.rewards).mockResolvedValue({ rewards: [], availableMiles: 20 });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function Location() { return <p>{useLocation().pathname}</p>; }
const mount = () => render(<MemoryRouter initialEntries={['/mypage?liffId=store']}><MyPage /><Location /></MemoryRouter>);

it('回数券の取得失敗は0件・準備中にせず、もう一度読み込める', async () => {
  vi.mocked(api.entitlements).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ id: 'pass', name: '面談5回券', kind: 'ticket', remaining: 3, usable: true, expiresAt: '2099-01-01T00:00:00Z' }] as never);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /回数券.*もう一度読み込む/ }));
  fireEvent.click(await screen.findByRole('button', { name: /回数券.*残り 3 回/ }));
  expect(await screen.findByText('面談5回券')).toBeTruthy();
  expect(api.entitlements).toHaveBeenCalledTimes(2);
});
it('キャンセル待ちの行から、接続済みの予約履歴へ移る', async () => {
  vi.mocked(api.bookingWaitlists).mockResolvedValue({ waitlist: [{ id: 'wait', status: 'waiting' }] } as never);
  mount(); fireEvent.click(await screen.findByRole('button', { name: /キャンセル待ち.*1 件/ }));
  expect(await screen.findByText('/booking/history')).toBeTruthy();
  expect(screen.queryByText(/キャンセル待ちの一覧は現在準備中/)).toBeNull();
});
it('目的別停止が未対応なら宣伝スイッチを出さず、取得失敗と区別する', async () => {
  mount();
  expect(await screen.findByText('お知らせごとの受け取りの設定は現在準備中です。')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(api.updateNotificationPreference).not.toHaveBeenCalled();
});
it('通知設定の読取失敗は準備中にせず、再読込から復旧できる', async () => {
  vi.mocked(api.notificationPreferences).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ purposeSpecificEnforcement: true, items: [{ purpose: 'marketing', enabled: true, version: 2, label: '宣伝' }] } as never);
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByRole('switch', { name: 'キャンペーン・宣伝を受け取る' })).toBeTruthy();
});

it.each(['2020-01-01T00:00:00Z', 'invalid'])('SELL-05: 期限後・期限不明の予約では変更を出さず、詳細へ進める (%s)', async (deadline) => {
  vi.mocked(api.me).mockResolvedValue({ upcoming: [{ id: 'b', starts_at: '2099-01-01T00:00:00Z', status: 'confirmed', menu_name: '人工面談', staff_name: '人工担当', profile_image_url: null, menu_id: 'm', staff_id: 's', lock_version: 1, cancel_deadline_at: deadline }], past: [] });
  vi.mocked(api.menus).mockResolvedValue({ menus: [] });
  mount(); await screen.findByText('人工面談・人工担当');
  expect(screen.queryByRole('button', { name: '日時を変える' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '予約の詳細' }));
  expect(await screen.findByText('/booking/history')).toBeTruthy();
});

it('通知停止の保存が失敗したら元の値に戻し、失敗を示す', async () => {
  vi.mocked(api.notificationPreferences).mockResolvedValue({ purposeSpecificEnforcement: true, items: [{ purpose: 'marketing', enabled: true, version: 2, label: '宣伝' }] } as never);
  vi.mocked(api.updateNotificationPreference).mockRejectedValueOnce(new Error('offline'));
  mount(); const toggle = await screen.findByRole('switch', { name: 'キャンペーン・宣伝を受け取る' });
  fireEvent.click(toggle);
  expect(await screen.findByText(/変えられませんでした/)).toBeTruthy();
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(api.updateNotificationPreference).toHaveBeenCalledWith('store', 'marketing', false, 2);
});
it('保存応答で目的別停止が使えなくなったら、宣伝スイッチを隠す', async () => {
  vi.mocked(api.notificationPreferences).mockResolvedValue({ purposeSpecificEnforcement: true, items: [{ purpose: 'marketing', enabled: true, version: 2, label: '宣伝' }] } as never);
  vi.mocked(api.updateNotificationPreference).mockResolvedValueOnce({ purposeSpecificEnforcement: false, items: [] } as never);
  mount(); fireEvent.click(await screen.findByRole('switch', { name: 'キャンペーン・宣伝を受け取る' }));
  expect(await screen.findByText('お知らせごとの受け取りの設定は現在準備中です。')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
});
