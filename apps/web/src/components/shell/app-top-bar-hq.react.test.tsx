// @vitest-environment happy-dom
/*
 * ★V8 統括の上の帯（絵 V8-B/JKjsE・オーナー 2026-10-07「統括の方が全然良くない」）。
 *
 *   - 統括の画面では、切替の札に「統括」と統括名（/api/tenants/me）、名前の下に「統括」
 *   - パンくずの「ホーム」は統括のホーム（/hq）
 *   - 札から店を選んだら、その店へ入る（/ へ移る）
 *   - 店の画面・v7 の統括は今までどおり（「LINEアカウント」・役割の言葉）
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  pathname: '/hq',
  theme: 'v8' as 'v8' | 'v7',
  push: vi.fn(),
  setSelectedAccountId: vi.fn(),
  tenantsMe: vi.fn(),
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

vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname, useRouter: () => ({ push: fixture.push }) }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return { default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...props }, children) }
})
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'account-1', name: '然-NEN- 本店', displayName: null }],
    selectedAccountId: null,
    setSelectedAccountId: fixture.setSelectedAccountId,
    clearSelectedAccountId: vi.fn(),
    loading: false,
    error: null,
    refreshing: false,
    refreshAccounts: vi.fn(),
  }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageChrome: () => ({ title: null, crumbs: null, fullWidth: false, settingsNavInline: false }) }))
vi.mock('@/lib/use-manual-href', () => ({ useManualHref: () => null }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: '株式会社 然', iconUrl: null }) }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => fixture.theme }))
vi.mock('@/lib/api', () => ({
  api: {
    tenants: { me: fixture.tenantsMe },
    notifications: { center: { list: vi.fn(async () => ({ success: true, data: { unreadCount: 0 } })) } },
  },
}))

import AppTopBar from './app-top-bar'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('★V8 統括の上の帯', () => {
  beforeEach(() => {
    fixture.pathname = '/hq'
    fixture.theme = 'v8'
    fixture.push.mockReset()
    fixture.setSelectedAccountId.mockReset()
    fixture.tenantsMe.mockReset()
    fixture.tenantsMe.mockResolvedValue({ success: true, data: { name: '然 -NEN- 本部' } })
    document.documentElement.dataset.theme = fixture.theme
    window.localStorage.setItem('lh_staff_name', 'Kenta Kawano')
    window.localStorage.setItem('lh_staff_role', 'owner')
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.theme
  })

  it('札は「統括」と統括名、ホームは /hq（自分の名前・ログアウトは左下へ移したので出さない）', async () => {
    const view = render(<AppTopBar />)
    await waitFor(() => expect(view.getAllByText('然 -NEN- 本部').length).toBeGreaterThan(0))
    // 「LINEアカウント」は V8 で隠れる外の見出しだけ（札の中の小さい字は「統括」）。店の画面では札の中にも出て 2 つになる。
    expect(view.getAllByText('LINEアカウント')).toHaveLength(1)
    expect(view.getAllByText('統括').length).toBeGreaterThanOrEqual(1)
    // ★V8 左下の自分とメニュー（オーナー 2026-10-07）：上の帯に名前とログアウトを出さない。
    expect(view.queryAllByText('Kenta Kawano')).toHaveLength(0)
    expect(view.queryAllByRole('button', { name: 'ログアウト' })).toHaveLength(0)
    expect(view.queryAllByText('オーナー')).toHaveLength(0)
    expect(view.getByRole('link', { name: 'ホーム' }).getAttribute('href')).toBe('/hq')
  })

  it('統括名が取れなければ「統括」で出す（帯は壊れない）', async () => {
    fixture.tenantsMe.mockRejectedValue(new Error('down'))
    const view = render(<AppTopBar />)
    await act(async () => { await Promise.resolve() })
    expect(view.queryAllByText('然 -NEN- 本部')).toHaveLength(0)
    expect(view.getAllByText('統括').length).toBeGreaterThanOrEqual(2)
  })

  it('札から店を選ぶと、その店へ入る', async () => {
    const view = render(<AppTopBar />)
    await act(async () => { await Promise.resolve() })
    fireEvent.change(view.getByRole('combobox', { name: 'LINEアカウント' }), { target: { value: 'account-1' } })
    expect(fixture.setSelectedAccountId).toHaveBeenCalledWith('account-1')
    expect(fixture.push).toHaveBeenCalledWith('/')
  })

  it('店の画面は今までどおり（「LINEアカウント」・役割はオーナー・ホームは /・選んでも移らない）', async () => {
    fixture.pathname = '/friends'
    const view = render(<AppTopBar />)
    await act(async () => { await Promise.resolve() })
    expect(fixture.tenantsMe).not.toHaveBeenCalled()
    expect(view.getAllByText('LINEアカウント')).toHaveLength(2)
    // ★V8：名前・役割・ログアウトは左下へ移した（オーナー 2026-10-07）。上の帯には出さない。
    expect(view.queryAllByText('Kenta Kawano')).toHaveLength(0)
    expect(view.queryAllByText('オーナー')).toHaveLength(0)
    expect(view.queryAllByRole('button', { name: 'ログアウト' })).toHaveLength(0)
    expect(view.getByRole('link', { name: 'ホーム' }).getAttribute('href')).toBe('/')
    fireEvent.change(view.getByRole('combobox', { name: 'LINEアカウント' }), { target: { value: 'account-1' } })
    expect(fixture.push).not.toHaveBeenCalled()
  })

  it('店の画面：切り替えの一覧はアカウントだけ。統括に戻るのは左下の自分のメニュー（オーナー 2026-10-08）', async () => {
    fixture.pathname = '/friends'
    const view = render(<AppTopBar />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(view.getByRole('button', { name: 'アカウントを切り替える' }))
    await waitFor(() => expect(view.getByRole('menuitemradio', { name: '然-NEN- 本店' })).toBeTruthy())
    expect(view.queryAllByRole('menuitem', { name: /統括に戻る/ })).toHaveLength(0)
    expect(view.queryAllByRole('button', { name: /統括へ/ })).toHaveLength(0)
  })

  it('店の画面：店だけの担当には［統括へ］も「統括に戻る」も出さない', async () => {
    fixture.pathname = '/friends'
    window.localStorage.setItem('lh_staff_role', 'staff')
    const view = render(<AppTopBar />)
    await act(async () => { await Promise.resolve() })
    expect(view.queryAllByRole('button', { name: /統括へ/ })).toHaveLength(0)
    fireEvent.click(view.getByRole('button', { name: 'アカウントを切り替える' }))
    await waitFor(() => expect(view.getByRole('menuitemradio', { name: '然-NEN- 本店' })).toBeTruthy())
    expect(view.queryAllByRole('menuitem', { name: /統括に戻る/ })).toHaveLength(0)
  })

  it('統括の画面には［統括へ］を出さない', async () => {
    const view = render(<AppTopBar />)
    await act(async () => { await Promise.resolve() })
    expect(view.queryAllByRole('button', { name: /統括へ/ })).toHaveLength(0)
  })

  it('v7 の統括は今までどおり（統括名を取らず、役割はオーナー）', async () => {
    fixture.theme = 'v7'
    document.documentElement.dataset.theme = 'v7'
    const view = render(<AppTopBar />)
    await act(async () => { await Promise.resolve() })
    expect(fixture.tenantsMe).not.toHaveBeenCalled()
    expect(view.getAllByText('オーナー').length).toBeGreaterThan(0)
    expect(view.getAllByText('店舗を選択').length).toBeGreaterThan(0)
    // v7 は上の帯に名前とログアウトを出したまま。
    expect(view.getAllByText('Kenta Kawano').length).toBeGreaterThan(0)
    expect(view.getAllByRole('button', { name: 'ログアウト' }).length).toBeGreaterThan(0)
  })

  it('v7 の店の画面も今までどおり（名前・役割・ログアウトは上の帯）', async () => {
    fixture.theme = 'v7'
    document.documentElement.dataset.theme = 'v7'
    fixture.pathname = '/friends'
    const view = render(<AppTopBar />)
    await act(async () => { await Promise.resolve() })
    expect(view.getAllByText('Kenta Kawano').length).toBeGreaterThan(0)
    expect(view.getAllByText('オーナー').length).toBeGreaterThan(0)
    expect(view.getAllByRole('button', { name: 'ログアウト' }).length).toBeGreaterThan(0)
  })
})
