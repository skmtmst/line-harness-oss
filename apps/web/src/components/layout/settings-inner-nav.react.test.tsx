// @vitest-environment happy-dom
/*
 * ★V8（夕41）：設定の画面の、白い板の中の左の「設定の中のメニュー」。
 *
 *   - 絵の並び（会社とロゴは API ができるまで出さない）
 *   - 機能設定の下にマニュアルの正本表・ファイルの検査
 *   - 「専用」の小見出しの下に EC連携・LINE通知
 *   - いまの画面が選ばれた形になる
 *   - 見るだけの人には、見られる画面だけ出す（左のメニューと同じ決まり）
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  visibility: vi.fn(),
  pathname: '/settings',
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
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
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
    clearFeatureVisibilityCache()
    fixture.visibility.mockReset()
    fixture.pathname = '/settings'
    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { ec_commerce: true, line_notifications: true } },
    })
    window.localStorage.clear()
    window.localStorage.setItem('lh_staff_role', 'owner')
  })

  afterEach(() => cleanup())

  // 2026-10-06：設定の板（ihjfd ほか 8 枚）の並びへ。見出し「設定」・印つき・プール管理あり・「専用」の小見出しなし。
  it('絵の並びで出す：はじめの設定・LINEアカウント・プール管理・ログインユーザー・機能設定・運用状態・EC連携・LINE通知（SNS 連携は末尾）', async () => {
    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { ec_commerce: true, line_notifications: true, multi_store_hierarchy: true } },
    })
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(view.queryByRole('link', { name: 'プール管理' })).toBeTruthy())
    const links = view.getAllByRole('link').map((link) => link.textContent)
    expect(links).toEqual([
      'はじめの設定',
      'LINEアカウント',
      'プール管理',
      'ログインユーザー',
      '機能設定',
      // 機能設定を開いているときだけ下の2つを出す（絵には無いが、ここからしか行けない）
      'マニュアルの正本表',
      'ファイルの検査',
      '運用状態',
      'EC連携',
      'LINE通知',
      // 提案 E-6：今ある絵の並びを動かさないよう末尾に足した
      'SNS 連携',
    ])
    expect(view.getByText('設定')).toBeTruthy()
    expect(view.queryByText('専用')).toBeNull()
    // 「会社とロゴ」は API ができるまで出さない
    expect(view.queryByText('会社とロゴ')).toBeNull()
  })

  it('SNS 連携の画面では SNS 連携が今の画面になり、機能設定の下の2つは出さない', async () => {
    fixture.pathname = '/settings/sns'
    fixture.visibility.mockResolvedValue({ success: true, data: { features: {} } })
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(view.queryByRole('link', { name: 'SNS 連携' })).toBeTruthy())
    expect(view.getByRole('link', { name: 'SNS 連携' }).getAttribute('aria-current')).toBe('page')
    expect(view.getByRole('link', { name: '機能設定' }).getAttribute('aria-current')).toBeNull()
    expect(view.queryByRole('link', { name: 'ファイルの検査' })).toBeNull()
  })

  it('機能設定の下の2つは、ほかの設定の画面では出さない', async () => {
    fixture.pathname = '/accounts'
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    expect(view.queryByRole('link', { name: 'マニュアルの正本表' })).toBeNull()
    expect(view.getByRole('link', { name: 'LINEアカウント' }).className).toContain('itemActive')
  })

  it('いまの画面は選ばれた形（aria ではなく className の薄い地）になる', async () => {
    fixture.pathname = '/settings/manual-links'
    const view = render(<SettingsInnerNav />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    const child = view.getByRole('link', { name: 'マニュアルの正本表' })
    expect(child.className).toContain('itemActive')
    const parent = view.getByRole('link', { name: '機能設定' })
    expect(parent.className).not.toContain('itemActive')
  })

  it('見るだけの人には見られる画面だけ出す（スタッフにはログインユーザーを出さない）', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
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
