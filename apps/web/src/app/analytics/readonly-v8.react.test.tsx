// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

const state = vi.hoisted(() => ({ role: 'viewer', query: '', account: 'account-a', calls: [] as string[] }))
const metric = (value: number | null) => ({ value, state: value === null ? 'unavailable' : 'available', reason: value === null ? '未取得' : null })
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('@/components/layout/merged-tabs', () => ({ default: () => null, useMergedTab: () => 'friends' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account, loading: false }) }))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    staff: { me: async () => ({ success: true, data: { role: state.role } }) },
    analytics: {
      friendsOverview: async (account: string, range: unknown) => {
        state.calls.push(`${account}:${JSON.stringify(range)}`)
        return { success: true, data: { period: { from: '2026-09-01', to: '2026-09-30' }, dataCutoffAt: '2026-09-30T00:00:00Z', data: { state: 'available', stateReason: null, metrics: { added: metric(48), removed: metric(11), net: metric(37), currentFriends: metric(1284), firstTime: metric(45) }, days: [{ date: '2026-09-01', added: 2, removed: 1, net: 1 }], campaigns: [] } } }
      },
      routesOverview: async () => ({ success: true, data: { data: { routes: [] } } }),
    },
    conversions: { definitionReport: async (params: { lineAccountId: string }) => { state.calls.push(`report:${params.lineAccountId}`); return { success: false } } },
  },
}))
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  state.role = 'viewer'; state.query = ''; state.account = 'account-a'; state.calls = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => { root.render(<AnalyticsPage />) }) }

describe('V8の閲覧と実測値の保護', () => {
  it('閲覧者は作成できず、集計値と閲覧の切り替えは残る', async () => {
    await render()
    expect(host.querySelector('[data-analytics-design]')?.getAttribute('data-design-node')).toBe('L4Uov')
    const create = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('レポートを作る'))
    expect(create?.disabled).toBe(true)
    expect(host.querySelector('nav[aria-label="分析の組"] a[aria-current]')?.textContent).toBe('ふだん見る')
    expect(host.querySelector('a[href="/analytics?tab=routes"]')).not.toBeNull()
    expect(host.textContent).toContain('37')
    expect(host.textContent).not.toContain('+47')
  })
  it('期間を変えると選択中アカウントの集計を取得し直す', async () => {
    await render()
    const range = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '7日')!
    await act(async () => range.click())
    expect(state.calls.length).toBe(2)
    expect(state.calls.every((call) => call.startsWith('account-a:'))).toBe(true)
    expect(range.getAttribute('aria-pressed')).toBe('true')
  })
  it('成果地点レポートの新入口は対象アカウントを引き継ぎ、取得失敗を再読込できる', async () => {
    state.query = 'view=conversion-report'
    await render()
    expect(state.calls).toEqual(['report:account-a'])
    expect(host.querySelector('[data-design-node="AzrZq"]')).not.toBeNull()
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === 'もう一度読む')!
    await act(async () => retry.click())
    expect(state.calls).toEqual(['report:account-a', 'report:account-a'])
  })
})
