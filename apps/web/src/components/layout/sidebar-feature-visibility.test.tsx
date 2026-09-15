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
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return { default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...props }, children) }
})
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
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

describe('Sidebarのstaff向け機能表示read-model', () => {
  beforeEach(() => {
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

    await waitFor(() => {
      act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated')))
      expect(fixture.visibility).toHaveBeenCalledWith('account-1')
      expect(view.queryAllByText('シナリオ配信')).toHaveLength(0)
    })
    expect(view.getAllByText('一斉配信')).not.toHaveLength(0)
    expect(fixture.get).not.toHaveBeenCalled()
  })

  it('ownerは従来の管理GETから保存済みの並びを読む', async () => {
    window.localStorage.setItem('lh_staff_role', 'owner')
    expect(window.localStorage.getItem('lh_staff_role')).toBe('owner')
    render(<Sidebar />)
    await waitFor(() => {
      act(() => window.dispatchEvent(new CustomEvent('line-harness:feature-settings-updated')))
      expect(fixture.get).toHaveBeenCalledWith('account-1')
    })
  })
})
