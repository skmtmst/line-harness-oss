// @vitest-environment happy-dom
/*
 * V8 友だち追加時の配信の一覧から先への行き先の試験。
 * - 行の名前を押すと、その設定の編集へ進む
 * - 頭の「実行結果を見る」は全部の記録へ、行の「実行結果を見る」はその設定の記録だけへ進む
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/friend-add-settings',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

import FriendAddListV8 from './list'
import type { FriendAddRule } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RULE: FriendAddRule = {
  id: 'rule/shop', accountId: 'account-a', friendKind: 'first_time', name: '店頭QRの初回案内', folderName: null,
  priority: 1, isFallback: false, status: 'published', versionId: 'v1', versionNumber: 1, versionStatus: 'published',
  lastTestStatus: null, lastTestedAt: null, lastTestedByStaffId: null, lastTestedByStaffName: null, publishedAt: null,
  matchedLast7Days: 41, version: 1, routeNames: ['店頭QRコード'], scenarioName: null,
  definition: {
    routeIds: ['route-shop'], scenarioId: null, messageType: 'text', messageText: 'ようこそ', timing: 'immediate',
    actions: [], friendCondition: '', activeFrom: null, activeUntil: null,
  },
} as FriendAddRule

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  nav.push.mockClear()
  window.history.replaceState(null, '', '/friend-add-settings')
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/staff/me') return json({ success: true, data: { role: 'owner' } })
    if (url.pathname === '/api/friend-add-rules') {
      return json({
        success: true,
        data: {
          items: [RULE], total: 1, nextCursor: null, folderCounts: [],
          summary: { rules: 1, active: 1, recentAdds: 0, captured: 0, unknownRoute: 0, delivered: 0, failed: 0 },
          options: { routes: [], scenarios: [], tags: [], folders: [] },
        },
      })
    }
    return json({ success: true, data: null })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

async function render() {
  await act(async () => { root.render(<FriendAddListV8 />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

describe('友だち追加時の配信の一覧の行き先', () => {
  it('行の名前を押すと、その設定の編集へ進む', async () => {
    await render()
    const name = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-row-id="rule/shop"] a'))
      .find((link) => link.textContent?.includes('店頭QRの初回案内'))
    expect(name?.getAttribute('href')).toBe('/friend-add-settings?view=edit&id=rule%2Fshop')
  })

  it('頭の「実行結果を見る」は全部の記録へ、行の「実行結果を見る」はその設定の記録だけへ進む', async () => {
    await render()
    const header = Array.from(host.querySelectorAll<HTMLAnchorElement>('a')).find((link) => link.textContent?.trim() === '実行結果を見る')
    expect(header?.getAttribute('href')).toBe('/friend-add-settings/runs')
    const menu = host.querySelector<HTMLButtonElement>('button[aria-label="設定「店頭QRの初回案内」の操作"]')
    await act(async () => { menu!.click() })
    const runs = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent?.trim() === '実行結果を見る')
    await act(async () => { runs!.click() })
    expect(nav.push).toHaveBeenCalledWith('/friend-add-settings/runs?rule_id=rule%2Fshop')
  })
})
