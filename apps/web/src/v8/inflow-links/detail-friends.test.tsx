// @vitest-environment happy-dom
/*
 * 監査 WEB035/036：流入経路の詳細。
 * - 036：来た友だちの読み込みに失敗したら「まだいません」と言わず、読み直しを出す
 * - 035：経路 A→B と移ったあとに A の友だち・数が遅れて届いても、B の数のまま
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const nav = vi.hoisted(() => ({ id: 'er-a' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/inflow-links/detail',
  useSearchParams: () => new URLSearchParams(`id=${nav.id}`),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null, accounts: [], loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

import InflowDetailV8 from './detail'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const route = (id: string, refCode: string, name: string) => ({
  id, refCode, genre: null, name, tagId: configuredTag, scenarioId: null, redirectUrl: null, poolId: null, introTemplateId: null,
  runAccountFriendAddScenarios: true, isActive: routeActive, stoppedAt: null, stoppedReason: null, lineAccountId: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
})
const funnel = (adds: number) => ({ click_count: 100, friend_add_count: adds, cv_count: 0, blockedCount: 0, remainingCount: adds, valuePerFriend: null })

let root: Root
let host: HTMLDivElement
let configuredTag: string | null = null
let routeActive = true
let friendsFor: (ref: string) => Promise<Response>

beforeEach(() => {
  nav.id = 'er-a'
  configuredTag = null
  routeActive = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  friendsFor = async () => json({ success: true, data: { friends: [] } })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/entry-routes/er-a') return json({ success: true, data: route('er-a', 'ref-a', '経路A') })
    if (url.pathname === '/api/entry-routes/er-b') return json({ success: true, data: route('er-b', 'ref-b', '経路B') })
    if (url.pathname === '/api/entry-routes/er-a/funnel') return json({ success: true, data: funnel(111) })
    if (url.pathname === '/api/entry-routes/er-b/funnel') return json({ success: true, data: funnel(222) })
    if (url.pathname === '/api/tags') return json({ success: true, data: configuredTag ? [{ id: configuredTag, name: 'VIP' }] : [] })
    if (url.pathname.startsWith('/api/analytics/ref/')) return friendsFor(decodeURIComponent(url.pathname.split('/').pop() ?? ''))
    return json({ success: true, data: [] })
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function settle() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('流入経路の詳細（WEB035/036）', () => {
  it('経路で設定したタグを、各友だちへ付いたタグの実績として代用しない', async () => {
    configuredTag = 'tag-vip'
    friendsFor = async () => json({ success: true, data: { friends: [{ id: 'f1', displayName: '来た友だち', trackedAt: '2026-10-01T00:00:00Z', currentStatus: 'active' }] } })
    await act(async () => { root.render(<InflowDetailV8 />) })
    await settle()
    expect(host.textContent).toContain('タグ「VIP」を付けて')
    const row = [...host.querySelectorAll('tbody tr')].find((element) => element.textContent?.includes('来た友だち'))
    expect(row).toBeTruthy()
    expect(row?.querySelectorAll('td')[4].textContent).toBe('—')
    expect(row?.textContent).not.toContain('VIP')
  })

  it('来た友だちが読めなかったら、「まだいません」ではなく読み直しを出す', async () => {
    friendsFor = async () => json({ success: false, error: 'down' }, 503)
    await act(async () => { root.render(<InflowDetailV8 />) })
    await settle()
    expect(host.textContent).toContain('この経路から来た友だちを読み込めませんでした')
    expect(host.textContent).not.toContain('この経路から来た友だちは、まだいません')
  })

  it('A の友だちが遅れて届いても、B の数のまま', async () => {
    let releaseA: () => void = () => undefined
    friendsFor = async (ref) => {
      if (ref === 'ref-a') await new Promise<void>((resolve) => { releaseA = resolve })
      return json({ success: true, data: { friends: [] } })
    }
    await act(async () => { root.render(<InflowDetailV8 />) })
    await settle()
    nav.id = 'er-b'
    await act(async () => { root.render(<InflowDetailV8 />) })
    await settle()
    await act(async () => { releaseA() })
    await settle()
    expect(host.textContent).toContain('222')
    expect(host.textContent).not.toContain('111')
  })
})

describe('R11: 流入後の成果の帯は4枚、5つ目は下の1行', () => {
  it('返金・取消は帯の下の短い1行で注文明細へ行ける', async () => {
    await act(async () => { root.render(<InflowDetailV8 />) })
    await settle()
    const band = host.querySelector('[aria-label="流入後の成果"]')
    expect(band).not.toBeNull()
    // 帯の中は4枚だけ。
    expect(band!.querySelectorAll('[data-kpi-presentation]').length).toBe(4)
    // 5つ目は帯の外の短い1行。
    expect(host.textContent).toContain('返金・取消')
    const go = [...host.querySelectorAll('button')].find((button) => button.textContent === '注文明細へ →')
    expect(go).not.toBeUndefined()
    expect(go!.closest('[aria-label="流入後の成果"]')).toBeNull()
    await act(async () => { go!.click() })
    await settle()
    const toggle = [...host.querySelectorAll('button')].find((button) => button.textContent === '注文を見る')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('月の区切りは日本時間（WEB038）', () => {
  it('日本時間で10月1日1時の友だちは10月に数える', async () => {
    const { monthKeyOf } = await import('./detail')
    expect(monthKeyOf('2026-09-30T16:00:00.000Z')).toBe('2026-10')
    expect(monthKeyOf('2026-09-30T14:00:00.000Z')).toBe('2026-09')
  })
})

it('操作の案内はその後のメニューを指す', async () => {
  await act(async () => { root.render(<InflowDetailV8 />) }); await settle()
  expect(host.textContent).toContain('「その後」の「…」から')
  expect(host.textContent).not.toContain('右上の「…」から')
})

it('停止中の経路には停止を出さず、再開を選べる', async () => {
  routeActive = false
  await act(async () => { root.render(<InflowDetailV8 />) }); await settle()
  const menu = host.querySelector<HTMLButtonElement>('button[aria-label^="この経路の操作"]')!
  await act(async () => { menu.click() })
  const menuItems = [...document.querySelectorAll('[role="menuitem"]')].map(node => node.textContent)
  expect(menuItems).not.toContain('受付を止める')
  expect(menuItems).toContain('受付を再開する')
  const entries = [...document.querySelectorAll('[role="menuitem"]')]
  expect(entries.find(node => node.textContent === '受付を再開する')?.querySelector('svg.lucide-play')).toBeTruthy()
  expect(entries.find(node => node.textContent === '別リンクへ送る')?.querySelector('svg.lucide-arrow-right')).toBeTruthy()
})

it('読み込み中は停止も再開も対象にしない', async () => {
  const { routeMenuState } = await import('./detail')
  expect(routeMenuState(null)).toBeNull()
  expect(routeMenuState({ isActive: true })).toBe('stop')
  expect(routeMenuState({ isActive: false })).toBe('resume')
})

it('経路の取得中は再開する操作や案内を出さない', async () => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/entry-routes/er-a') return new Promise<Response>(() => {})
    return Promise.resolve(json({ success: true, data: [] }))
  })
  await act(async () => { root.render(<InflowDetailV8 />) }); await settle()
  expect(host.textContent).not.toContain('受付を再開する')
  expect(host.querySelector('button[aria-label^="この経路の操作"]')).toBeNull()
})

it('受付を止めると削除には共通メニューの印を付ける', async () => {
  await act(async () => { root.render(<InflowDetailV8 />) }); await settle()
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label^="この経路の操作"]')!.click() })
  const entries = [...document.querySelectorAll('[role="menuitem"]')]
  expect(entries.find(node => node.textContent === '受付を止める')?.querySelector('svg.lucide-pause')).toBeTruthy()
  expect(entries.find(node => node.textContent === '削除する')?.querySelector('svg.lucide-trash-2')).toBeTruthy()
})
