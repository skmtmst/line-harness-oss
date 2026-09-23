// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const localStorageValues = new Map<string, string>()
const testLocalStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
  removeItem: (key: string) => { localStorageValues.delete(key) },
  clear: () => { localStorageValues.clear() },
}
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testLocalStorage,
})
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: testLocalStorage,
})

const fixture = vi.hoisted(() => ({
  visibility: vi.fn(),
  get: vi.fn(),
  accountId: 'account-1',
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return { default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...props }, children) }
})
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: '会社', iconUrl: null }) }))
vi.mock('@/components/layout/sidebar-identity', () => ({ default: () => <div>identity</div> }))
vi.mock('@/components/hq/account-menu', () => ({ default: () => <div>hq</div> }))
vi.mock('@/lib/api', () => ({
  api: {
    featureSettings: {
      visibility: fixture.visibility,
      get: fixture.get,
    },
    inbox: { unanswered: { count: vi.fn(async () => ({ success: true, data: { total: 0 } })) } },
    nenMembers: { overview: vi.fn(async () => ({ success: true, data: { pendingPhotos: 0 } })) },
    health: { summary: vi.fn(async () => ({ success: true, data: { warningCount: 0, dangerCount: 0 } })) },
  },
}))

import Sidebar from './sidebar'
import { clearFeatureVisibilityCache } from '@/lib/feature-visibility-cache'

describe('Sidebarのstaff向け機能表示read-model', () => {
  beforeEach(() => {
    // 表示可否は画面間で共有される（V6R-S0-b）。試験ごとに応答を替えるので毎回捨てる。
    clearFeatureVisibilityCache()
    fixture.accountId = 'account-1'
    window.localStorage.clear()
    fixture.visibility.mockReset()
    fixture.get.mockReset()
    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { scenarios: false, broadcasts: true } },
    })
    fixture.get.mockResolvedValue({
      success: true,
      data: {
        features: { scenarios: true, broadcasts: true },
        sidebarOrder: null,
        sidebarItemOrder: null,
        specializedFeatureKeys: [],
      },
    })
  })

  afterEach(() => cleanup())

  it('一般staffは最小read-modelだけを使い、offの項目を隠す', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    window.localStorage.setItem('lh_staff_permissions', JSON.stringify(['/scenarios', '/broadcasts']))
    expect(window.localStorage.getItem('lh_staff_role')).toBe('staff')
    const view = render(<Sidebar />)

    await waitFor(() => expect(fixture.visibility).toHaveBeenCalledWith('account-1'))
    act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated')))
    await waitFor(() => {
      expect(fixture.visibility).toHaveBeenCalledWith('account-1')
      expect(view.queryAllByText('シナリオ配信')).toHaveLength(0)
      expect(view.getAllByText('一斉配信')).not.toHaveLength(0)
    })
    expect(fixture.get).not.toHaveBeenCalled()
  })

  it('multi_store_hierarchy: offと応答欠落では「プール管理」を出さず、onで出す(#860)', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    window.localStorage.setItem('lh_staff_permissions', JSON.stringify(['/broadcasts', '/pools']))
    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { multi_store_hierarchy: false, broadcasts: true } },
    })
    const view = render(<Sidebar />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalledWith('account-1'))
    act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated')))
    await waitFor(() => expect(view.getAllByText('一斉配信')).not.toHaveLength(0))
    expect(view.queryAllByText('プール管理')).toHaveLength(0)
    // 必須の基本ナビは機能キーを持たないので残る。
    expect(view.getAllByText('ダッシュボード')).not.toHaveLength(0)
    cleanup()

    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { broadcasts: true } },
    })
    const missing = render(<Sidebar />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalledTimes(2))
    act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated')))
    await waitFor(() => expect(missing.getAllByText('一斉配信')).not.toHaveLength(0))
    expect(missing.queryAllByText('プール管理')).toHaveLength(0)
    cleanup()

    fixture.visibility.mockResolvedValue({
      success: true,
      data: { features: { multi_store_hierarchy: true, broadcasts: true } },
    })
    const enabled = render(<Sidebar />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
    act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated')))
    await waitFor(() => expect(enabled.getAllByText('プール管理')).not.toHaveLength(0))
    expect(enabled.getAllByText('一斉配信')).not.toHaveLength(0)
  })

  it('ownerも表示可否は最小read-modelから読み、管理GETは並び用に追加する', async () => {
    window.localStorage.setItem('lh_staff_role', 'owner')
    expect(window.localStorage.getItem('lh_staff_role')).toBe('owner')
    render(<Sidebar />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalledWith('account-1'))
    act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated')))
    await waitFor(() => {
      expect(fixture.visibility).toHaveBeenCalledWith('account-1')
      expect(fixture.get).toHaveBeenCalledWith('account-1')
    })
  })

  it('保存roleがadminでも管理GETが403なら、staff向け表示可否を捨てない', async () => {
    window.localStorage.setItem('lh_staff_role', 'admin')
    window.localStorage.setItem('lh_staff_permissions', JSON.stringify(['/scenarios', '/broadcasts']))
    fixture.get.mockRejectedValue(new Error('403 Forbidden'))
    const view = render(<Sidebar />)

    await waitFor(() => expect(fixture.visibility).toHaveBeenCalledWith('account-1'))
    act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated')))
    await waitFor(() => {
      expect(fixture.visibility).toHaveBeenCalledWith('account-1')
      expect(fixture.get).toHaveBeenCalledWith('account-1')
      expect(view.queryAllByText('シナリオ配信')).toHaveLength(0)
      expect(view.getAllByText('一斉配信')).not.toHaveLength(0)
    })
  })

  it.each([
    ['features欠落', { success: true, data: {} }],
    ['featuresが配列', { success: true, data: { features: [] } }],
    ['値がboolean以外', { success: true, data: { features: { scenarios: 'false' } } }],
  ])('古い・不正な応答（%s）では任意機能を出さず、画面全体を落とさない', async (_label, response) => {
    fixture.visibility.mockResolvedValue(response as never)
    const view = render(<Sidebar />)

    await waitFor(() => expect(fixture.visibility).toHaveBeenCalledWith('account-1'))
    await waitFor(() => expect(view.queryAllByText('一斉配信')).toHaveLength(0))
    await waitFor(() => expect(view.getAllByText('もう一度読み込む')).not.toHaveLength(0))
    expect(view.getAllByText('ダッシュボード')).not.toHaveLength(0)
  })

  it('loading/error/retryとaccount切替の遅延応答で、未確認・古い任意機能を表示しない', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    window.localStorage.setItem('lh_staff_permissions', JSON.stringify(['/broadcasts']))
    fixture.visibility
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce({ success: true, data: { features: { broadcasts: true } } })
    const view = render(<Sidebar />)

    // 初回の未確認状態も、失敗状態も必須ナビだけを残す。
    expect(view.queryAllByText('一斉配信')).toHaveLength(0)
    expect(view.getAllByText('ダッシュボード')).not.toHaveLength(0)
    await waitFor(() => expect(view.getAllByText('もう一度読み込む')).not.toHaveLength(0))
    await act(async () => { view.getAllByText('もう一度読み込む')[0]?.click() })
    await waitFor(() => expect(view.getAllByText('一斉配信')).not.toHaveLength(0))

    let resolveOld: ((value: unknown) => void) | undefined
    let resolveCurrent: ((value: unknown) => void) | undefined
    fixture.visibility.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    fixture.visibility.mockImplementationOnce(() => new Promise((resolve) => { resolveCurrent = resolve }))
    fixture.accountId = 'account-old'
    view.rerender(<Sidebar />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalledWith('account-old'))
    expect(view.queryAllByText('一斉配信')).toHaveLength(0)
    fixture.accountId = 'account-current'
    view.rerender(<Sidebar />)
    await waitFor(() => expect(fixture.visibility).toHaveBeenCalledWith('account-current'))
    await act(async () => { resolveCurrent?.({ success: true, data: { features: { broadcasts: true } } }) })
    await waitFor(() => expect(view.getAllByText('一斉配信')).not.toHaveLength(0))
    await act(async () => { resolveOld?.({ success: true, data: { features: { broadcasts: false } } }) })
    expect(view.getAllByText('一斉配信')).not.toHaveLength(0)
  })
})
