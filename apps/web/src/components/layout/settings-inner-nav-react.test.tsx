// @vitest-environment happy-dom
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import type { StaffMember } from '@line-crm/shared'
/*
 * ★V8（夕41）：設定の画面の、白い板の中の左の「設定の中のメニュー」。
 *
 *   - 絵の並び（会社とロゴは API ができるまで出さない）
 *   - マニュアルの対応表・ファイルの安全確認も同じ段の項目
 *   - 「専用」の小見出しの下に EC連携・LINE通知
 *   - いまの画面が選ばれた形になる
 *   - 見るだけの人には、見られる画面だけ出す（左のメニューと同じ決まり）
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  visibility: vi.fn(),
  pathname: '/settings',
  accountId: 'account-1',
}))

const localStorageValues = new Map<string, string>()
const testLocalStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
  removeItem: (key: string) => { localStorageValues.delete(key) },
  clear: () => { localStorageValues.clear() },
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testLocalStorage })
Object.defineProperty(window, 'localStorage', { configurable: true, value: testLocalStorage })

vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return { default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...props }, children) }
})
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('@/lib/api', () => ({
  api: {
    featureSettings: { visibility: fixture.visibility },
  },
}))

import SettingsInnerNav, { isSettingsAreaPath } from './settings-inner-nav'
import { clearFeatureVisibilityCache } from '@/lib/feature-visibility-cache'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('★V8 設定の中のメニュー', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_RESTAURANT_TEST_ENABLED', 'false')
    forgetStaffIdentity()
    clearFeatureVisibilityCache()
    fixture.visibility.mockReset()
    fixture.pathname = '/settings'
    fixture.accountId = 'account-1'
    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { ec_commerce: true, line_notifications: true } },
    })
    window.localStorage.clear()
    window.localStorage.setItem('lh_staff_role', 'owner')
    rememberStaffIdentity({ role: 'owner', accountScope: 'all' } as StaffMember)
  })

  afterEach(() => { cleanup(); vi.unstubAllEnvs() })

  it('WEB252: 切替先が読込中なら前の機能を出さず、設定保存後に再取得する', async () => {
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(view.queryByText('EC連携')).toBeTruthy())
    fixture.visibility.mockReturnValue(new Promise(() => {}))
    fixture.accountId = 'account-2'
    view.rerender(<SettingsInnerNav />)
    expect(view.queryByText('EC連携')).toBeNull()
    await waitFor(() => expect(fixture.visibility.mock.calls.length).toBe(2))
    fixture.visibility.mockResolvedValue({ success: true, data: { features: { ec_commerce: true } } })
    act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated', { detail: { accountId: 'account-2' } })))
    await waitFor(() => expect(fixture.visibility.mock.calls.length).toBe(3))
    await waitFor(() => expect(view.queryByText('EC連携')).toBeTruthy())
  })

  // 2026-10-06：設定の板（ ほか 8 枚）の並びへ。見出し「設定」・印つき・プール管理あり・「専用」の小見出しなし。
  it('絵の並びで出す：はじめの設定・LINEアカウント・プール管理・ログインユーザー・機能設定・運用状態・EC連携・LINE通知（SNS 連携は末尾）', async () => {
    rememberStaffIdentity({ role: 'owner', accountScope: 'all' } as StaffMember)
    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { ec_commerce: true, line_notifications: true, multi_store_hierarchy: true } },
    })
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(view.queryByRole('link', { name: 'プール管理' })).toBeTruthy())
    const links = view.getAllByRole('link').map((link) => link.textContent)
    expect(links).toEqual([
      // （10-11）で足したお客さまのデザイン。絵  では会社とロゴ（API 待ち）の次。
      'お客さまのデザイン',
      'はじめの設定',
      'LINEアカウント',
      'プール管理',
      'ログインユーザー',
      '機能設定',
      // 2つの設定も同じ段に並べる
      'マニュアルの対応表',
      'ファイルの安全確認',
      '運用状態',
      'EC連携',
      'LINE通知',
      // 提案 E-6：今ある絵の並びを動かさないよう末尾に足した
      'SNS 連携', '予約サイト・グルメ媒体', 'デリバリー連携',
    ])
    expect(view.getByText('設定')).toBeTruthy()
    expect(view.queryByText('専用')).toBeNull()
    // 「会社とロゴ」は API ができるまで出さない
    expect(view.queryByText('会社とロゴ')).toBeNull()
  })

  it('店舗に所属する管理者の設定メニューにLINEアカウント管理を出さない', async () => {
    rememberStaffIdentity({ role: 'admin', accountScope: 'accounts' } as StaffMember)
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    expect(view.queryByRole('link', { name: 'LINEアカウント' })).toBeNull()
    expect(view.getByRole('link', { name: '機能設定' })).toBeTruthy()
  })

  // 2026-10-12：デリバリー連携（承認案 DL-1 `dF4Ov`）を予約サイト・グルメ媒体の下に足した
  it('検証環境でも予約サイト・グルメ媒体とデリバリー連携へ進める', async () => {
    vi.stubEnv('NEXT_PUBLIC_RESTAURANT_TEST_ENABLED', 'true')
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    const booking = view.getByRole('link', { name: '予約サイト・グルメ媒体' })
    const delivery = view.getByRole('link', { name: 'デリバリー連携' })
    expect(booking.getAttribute('href')).toBe('/settings/booking-media')
    expect(delivery.getAttribute('href')).toBe('/settings/delivery')
    expect(view.getAllByRole('link').slice(-2)).toEqual([booking, delivery])
  })

  it('本番でも飲食店の設定の入口を残す', async () => {
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    expect(view.getByRole('link', { name: 'デリバリー連携' }).getAttribute('href')).toBe('/settings/delivery')
  })

  it('SNS 連携の画面でも2つの設定の入口を残し、現在地だけを示す', async () => {
    fixture.pathname = '/settings/sns'
    fixture.visibility.mockResolvedValue({ success: true, data: { features: {} } })
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(view.queryByRole('link', { name: 'SNS 連携' })).toBeTruthy())
    expect(view.getByRole('link', { name: 'SNS 連携' }).getAttribute('aria-current')).toBe('page')
    expect(view.getByRole('link', { name: '機能設定' }).getAttribute('aria-current')).toBeNull()
    expect(view.getByRole('link', { name: 'ファイルの安全確認' }).getAttribute('href')).toBe('/settings/file-scan')
  })

  it('LINE通知の画面では機能設定を同時に選択しない', async () => {
    fixture.pathname = '/line-notifications'
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(view.getByRole('link', { name: 'LINE通知' })).toBeTruthy())
    expect(view.getByRole('link', { name: 'LINE通知' }).getAttribute('aria-current')).toBe('page')
    expect(view.getByRole('link', { name: '機能設定' }).getAttribute('aria-current')).toBeNull()
    expect(view.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('2つの設定は、ほかの設定画面でも同じ段に残す', async () => {
    fixture.pathname = '/accounts'
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    expect(view.getByRole('link', { name: 'マニュアルの対応表' }).parentElement?.parentElement).toBe(view.getByRole('link', { name: '機能設定' }).parentElement?.parentElement)
    expect(view.getByRole('link', { name: 'LINEアカウント' }).className).toContain('itemActive')
  })

  it('いまの画面は選ばれた形とaria-currentで示す', async () => {
    fixture.pathname = '/settings/manual-links'
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    const child = view.getByRole('link', { name: 'マニュアルの対応表' })
    expect(child.className).toContain('itemActive')
    const parent = view.getByRole('link', { name: '機能設定' })
    expect(parent.className).not.toContain('itemActive')
  })

  it.each(['/settings', '/settings/manual-links', '/settings/file-scan', '/settings/sns'])('設定 %s でも項目を入れ子にせず現在地を1つだけ示す', async (pathname) => {
    fixture.pathname = pathname
    const view = render(<SettingsInnerNav inline />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    const nav = view.getByRole('navigation', { name: '設定の中のメニュー' })
    const parent = view.getByRole('link', { name: '機能設定' })
    const manual = view.getByRole('link', { name: 'マニュアルの対応表' })
    const scan = view.getByRole('link', { name: 'ファイルの安全確認' })
    for (const link of [manual, scan]) {
      expect(link.parentElement?.parentElement).toBe(parent.parentElement?.parentElement)
      expect(link.classList[0]).toBe(parent.classList[0])
      expect(link.querySelector('svg')).toBeTruthy()
    }
    expect(nav.querySelector('ul ul')).toBeNull()
    expect(view.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.getAttribute('href'))).toEqual([pathname])
  })

  it('見るだけの人には見られる画面だけ出す（スタッフにはログインユーザーを出さない）', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    rememberStaffIdentity({ role: 'staff' } as StaffMember)
    window.localStorage.setItem('lh_staff_permissions', JSON.stringify(['/emergency']))
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    const labels = view.getAllByRole('link').map((link) => link.textContent)
    expect(labels).not.toContain('ログインユーザー')
    expect(labels).not.toContain('LINEアカウント')
    // 必須項目（はじめの設定・機能設定・運用状態）は残る
    expect(labels).toContain('はじめの設定')
    expect(labels).toContain('機能設定')
  })

  it('隠れる項目でも、いま開いている画面なら選ばれた形で出す（閲覧のみのログインユーザー A35Gh）', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    rememberStaffIdentity({ role: 'staff' } as StaffMember)
    fixture.pathname = '/staff'
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    const link = view.getByRole('link', { name: 'ログインユーザー' })
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(view.queryByRole('link', { name: 'LINEアカウント' })).toBeNull()
  })

  it('任意機能がオフなら専用の項目は出ない', async () => {
    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { ec_commerce: false, line_notifications: false } },
    })
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    await waitFor(() => expect(view.queryByText('EC連携')).toBeNull())
    expect(view.queryByText('LINE通知')).toBeNull()
    expect(view.queryByText('専用')).toBeNull()
  })

  it('isSettingsAreaPath は設定の画面だけ true（ほかの画面・UID移行の外側判定）', () => {
    expect(isSettingsAreaPath('/settings')).toBe(true)
    expect(isSettingsAreaPath('/settings/file-scan')).toBe(true)
    expect(isSettingsAreaPath('/accounts')).toBe(true)
    expect(isSettingsAreaPath('/emergency')).toBe(true)
    expect(isSettingsAreaPath('/friends')).toBe(false)
    expect(isSettingsAreaPath('/broadcasts')).toBe(false)
    // /accounts/new は別の外枠なのでここには来ないが、一応パスとしては内側
  })
})
