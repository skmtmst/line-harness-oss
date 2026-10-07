// @vitest-environment happy-dom
/*
 * ★V8 機能設定（ywFJT）：閲覧のみ（オーナー・管理者以外）には、押せない操作を置かずに隠す
 * （2026-10-06 オーナー決定）。閲覧のみの帯は出し、オン／オフは文字で見せる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFeatureSettingsCache } from '@/lib/feature-settings-cache'

const fixture = vi.hoisted(() => ({ role: 'owner' }))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

const { default: FeatureSettingsScreen } = await import('./screen')

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  clearFeatureSettingsCache()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const path = String(input)
    if (path.includes('/api/staff/me')) return response({ success: true, data: { id: 'staff-1', role: fixture.role, permissionKeys: [] } })
    if (path.includes('/api/settings/features')) {
      return response({
        success: true,
        data: { features: { scenarios: true, broadcasts: true, webinars: false }, sidebarItemOrder: {}, specializedFeatureKeys: [], version: 3 },
      })
    }
    if (path.includes('/api/analytics/usage')) return response({ success: true, data: { categories: [] } })
    return response({ success: false, error: 'not found' }, 404)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }
}

const buttonNames = () => [...host.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')

describe('★V8 機能設定の閲覧のみ', () => {
  it('オーナーにはスイッチ・まとめて・並びを変える・保存の帯がある', async () => {
    fixture.role = 'owner'
    await act(async () => { root.render(<FeatureSettingsScreen />) })
    await flush()
    expect(host.querySelectorAll('[role="switch"]').length).toBeGreaterThan(0)
    expect(buttonNames()).toContain('並びを変える')
    expect(buttonNames()).toContain('まとめて')
    expect(buttonNames().some((name) => name.includes('機能設定を保存'))).toBe(true)
    expect(host.textContent).not.toContain('閲覧のみで見ています')
  })

  it('閲覧のみには押せない操作を置かず、帯とオン／オフの文字だけ出す', async () => {
    fixture.role = 'staff'
    await act(async () => { root.render(<FeatureSettingsScreen />) })
    await flush()
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(0)
    expect(buttonNames()).not.toContain('並びを変える')
    expect(buttonNames()).not.toContain('まとめて')
    expect(buttonNames().some((name) => name.includes('機能設定を保存'))).toBe(false)
    expect(buttonNames().some((name) => name.includes('初期値に戻す'))).toBe(false)
    expect(host.textContent).toContain('オフ')
  })
})
