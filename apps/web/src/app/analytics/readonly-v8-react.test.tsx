// @vitest-environment happy-dom
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

const state = vi.hoisted(() => ({ role: 'viewer', query: '', account: 'account-a', events: false, calls: [] as string[] }))
const metric = (value: number | null) => ({ value, state: value === null ? 'unavailable' : 'available', reason: value === null ? '未取得' : null })
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), usePathname: () => '/analytics', useSearchParams: () => new URLSearchParams(state.query) }))
vi.mock('@/components/layout/merged-tabs', () => ({ default: () => null, useMergedTab: () => 'friends' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account, loading: false }) }))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    staff: { me: async () => ({ success: true, data: { role: state.role } }) },
    analytics: {
      friendsOverview: async (account: string, range: unknown) => {
        state.calls.push(`${account}:${JSON.stringify(range)}`)
        return { success: true, data: { period: { from: '2026-09-01', to: '2026-09-30' }, dataCutoffAt: '2026-09-30T00:00:00Z', data: { state: 'available', stateReason: null, metrics: { added: metric(48), removed: metric(11), net: metric(37), currentFriends: metric(1284), firstTime: metric(45) }, days: [{ date: '2026-09-01', added: 2, removed: 1, net: 1 }], campaigns: state.events ? [{ id: 'broadcast-a', date: '2026-09-01', name: '秋のお知らせ', kind: 'broadcast' }, { id: 'scenario-a', date: '2026-09-01', name: '初回の案内', kind: 'scenario' }] : [] } } }
      },
      routesOverview: async () => ({ success: true, data: { period: { from: '2026-09-01', to: '2026-09-30' }, dataCutoffAt: '2026-09-30T00:00:00Z', data: { attributionModel: 'first_touch', attributionLabel: '最初に触れた経路', routes: [], searchConsoleHref: '/search-console' } } }),
    },
    conversions: { definitionReport: async (params: { lineAccountId: string }) => { state.calls.push(`report:${params.lineAccountId}`); return { success: false } } },
  },
}))
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  state.role = 'viewer'; state.query = ''; state.account = 'account-a'; state.events = false; state.calls = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => { root.render(<AnalyticsPage />) }) }

describe('V8の閲覧と実測値の保護', () => {
  it('閲覧者も出来事のある日を選び、元の増減を読んで選択を解除できる', async () => {
    state.events = true
    await render()
    const chart = host.querySelector('[role="group"][aria-label="日ごとの増減"]')!
    const day = chart.querySelector('button')!
    expect(day.getAttribute('aria-label')).toContain('増えた2人・減った1人・秋のお知らせ、初回の案内')
    expect(chart.querySelectorAll('[data-chart-event]')).toHaveLength(2)
    expect(host.querySelectorAll('[aria-label="凡例"]')).toHaveLength(1)
    const table = host.querySelector('table')!
    expect([...table.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['2人', '1人'])
    await act(async () => day.click())
    expect(day.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('増加 2 人・減少 1 人・差し引き 1 人')
    await act(async () => day.click())
    expect(day.getAttribute('aria-pressed')).toBe('false')
    expect(host.textContent).not.toContain('増加 2 人・減少 1 人・差し引き 1 人')
    expect(state.calls).toHaveLength(1)
    expect(host.querySelector('a[href="/analytics/reports/new"]')).toBeNull()
  })
  it('閲覧者は作成できず、集計値と閲覧の切り替えは残る', async () => {
    await render()
    expect(host.querySelector('[data-page-template]')?.getAttribute('data-design-node')).toBe('L4Uov')
    // 閲覧のみの人には作るボタンを置かない（オーナー決定 2026-10-06）。帯で閲覧のみと伝える。
    expect([...host.querySelectorAll('a, button')].some((el) => el.textContent?.includes('レポートを作る'))).toBe(false)
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(host.querySelector('[role="tablist"][aria-label="分析の組"] [aria-current="page"]')?.textContent).toBe('ふだん見る')
    expect(host.querySelector('a[href="/analytics?tab=routes"]')).not.toBeNull()
    expect(host.textContent).toContain('37')
    expect(host.textContent).not.toContain('+47')
  })
  it('期間を変えると選択中アカウントの集計を取得し直す', async () => {
    await render()
    const range = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '過去7日')!
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
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === 'もう一度読み込む')!
    await act(async () => retry.click())
    expect(state.calls).toEqual(['report:account-a', 'report:account-a'])
  })
})
