// @vitest-environment happy-dom
/*
 * J1-KPI-SCOPE: 帯（流入元・友だち・クリック・平均の追加率）は画面全体の
 * 要約なので、フォルダ選択・検索文字・友だち有無の絞り込みで変わらない。
 * 実 Worker の ref-summary は routeTotal / totalClicks / averageAddRate を
 * 返さない（任意項目の省略形）ので、通常は選択アカウント範囲
 * （絞り込みの前）から数える。本物の React で動かして見る。
 *
 * 6行の内訳: 友だち 10+5+2=17人、クリック 20+15+10=45回、率 38%。
 * 友だち追加なしは3行（店頭QR・DM・旧URL）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const accountState = vi.hoisted(() => ({ id: 'acc-1' }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: accountState.id, selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

import InflowLinksPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface RouteSeed {
  id: string
  refCode: string
  name: string
  genre: string | null
  isActive: boolean
  friends: number
  clicks: number
}

const ACC1_ROUTES: RouteSeed[] = [
  { id: 'er-1', refCode: 'spring', name: '春キャンペーン', genre: 'SNS', isActive: true, friends: 10, clicks: 20 },
  { id: 'er-2', refCode: 'summer', name: '夏キャンペーン', genre: 'SNS', isActive: true, friends: 5, clicks: 15 },
  { id: 'er-3', refCode: 'flyer', name: 'チラシ', genre: '代理店', isActive: false, friends: 2, clicks: 10 },
  { id: 'er-4', refCode: 'qr-shop', name: '店頭QR', genre: '代理店', isActive: true, friends: 0, clicks: 0 },
  { id: 'er-5', refCode: 'dm', name: 'DM', genre: null, isActive: true, friends: 0, clicks: 0 },
  { id: 'er-6', refCode: 'old', name: '旧URL', genre: 'SNS', isActive: false, friends: 0, clicks: 0 },
]

const ACC2_ROUTES: RouteSeed[] = [
  { id: 'er-b1', refCode: 'b-spring', name: 'B春', genre: 'SNS', isActive: true, friends: 5, clicks: 12 },
  { id: 'er-b2', refCode: 'b-old', name: 'B旧', genre: null, isActive: true, friends: 0, clicks: 0 },
]

/* 実 Worker の通常形: 任意の3項目を返さない。合法の混在形: totalClicks だけ返す。 */
let summaryMode: 'full-real' | 'mixed' | 'mixed90' | 'explicit-rate' | 'real3' | 'failed' | 'zero' = 'full-real'

function toEntryRoute(seed: RouteSeed) {
  return {
    id: seed.id,
    refCode: seed.refCode,
    name: seed.name,
    genre: seed.genre,
    poolId: null,
    tagId: null,
    scenarioId: null,
    runAccountFriendAddScenarios: false,
    isActive: seed.isActive,
  }
}

function toSummaryRoute(seed: RouteSeed) {
  return {
    refCode: seed.refCode,
    name: seed.name,
    friendCount: seed.friends,
    clickCount: seed.clicks,
    latestAt: null,
  }
}

function summaryData(routes: RouteSeed[], extra?: Record<string, unknown>) {
  const friends = routes.reduce((sum, r) => sum + r.friends, 0)
  return {
    routes: routes.map(toSummaryRoute),
    totalFriends: friends,
    friendsWithRef: friends,
    friendsWithoutRef: 0,
    ...extra,
  }
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'https://test.invalid')
    const path = url.pathname + url.search
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
    if (path.startsWith('/api/settings/features/visibility')) {
      return json({ success: true, data: { features: { inflow_tracking: true, site_tracking: true } } })
    }
    if (path.startsWith('/api/entry-routes')) {
      const account = url.searchParams.get('account_id') ?? 'acc-1'
      const routes = account === 'acc-2' ? ACC2_ROUTES : ACC1_ROUTES
      return json({ success: true, data: routes.map(toEntryRoute) })
    }
    if (path.startsWith('/api/analytics/ref-summary')) {
      const account = url.searchParams.get('lineAccountId') ?? 'acc-1'
      if (summaryMode === 'failed') return json({ success: false, error: 'Internal server error' }, 500)
      if (account === 'acc-2') return json({ success: true, data: summaryData(ACC2_ROUTES) })
      if (summaryMode === 'mixed') return json({ success: true, data: summaryData(ACC1_ROUTES, { totalClicks: 45 }) })
      if (summaryMode === 'mixed90') return json({ success: true, data: summaryData(ACC1_ROUTES, { totalClicks: 90 }) })
      if (summaryMode === 'explicit-rate') {
        return json({ success: true, data: summaryData(ACC1_ROUTES, { averageAddRate: 50 }) })
      }
      if (summaryMode === 'real3') {
        // 実 Worker は friends 起点なので、実績のある ref だけが routes に載る。
        // entry-routes 6行に対し summary.routes は3行。それでも帯は全体。
        const withResults = ACC1_ROUTES.slice(0, 3)
        return json({
          success: true,
          data: {
            routes: withResults.map(toSummaryRoute),
            totalFriends: 17,
            friendsWithRef: 17,
            friendsWithoutRef: 0,
          },
        })
      }
      if (summaryMode === 'zero') {
        const zeroed = ACC1_ROUTES.map((r) => ({ ...r, friends: 0, clicks: 0 }))
        return json({ success: true, data: summaryData(zeroed) })
      }
      return json({ success: true, data: summaryData(ACC1_ROUTES) })
    }
    if (path.startsWith('/api/scenarios')) {
      return json({ success: true, data: { items: [], total: 0, limit: 200, sort: [] } })
    }
    return json({ success: true, data: [] })
  }))
}

let host: HTMLDivElement
let root: Root

async function settle(milliseconds = 150) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

function kpiText(): string {
  return host.querySelector('[data-design="KPIs"]')?.textContent ?? ''
}

/* 帯の4枚を意味で特定する（順序: 流入元・友だちになった・クリック・平均の追加率）。 */
function kpiCards(): string[] {
  return Array.from(host.querySelectorAll('[data-design="KPIs"] > div')).map((el) => el.textContent ?? '')
}

async function setSearch(value: string) {
  const input = host.querySelector('input[placeholder="流入元の名前・REFで検索"]') as HTMLInputElement | null
  expect(input, '検索欄が見つからない').not.toBeNull()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

async function clickButton(scope: ParentNode, text: string) {
  const buttons = Array.from(scope.querySelectorAll('button'))
  const button = buttons.find((b) => b.textContent?.includes(text))
  expect(button, `「${text}」のボタンが見つからない`).toBeTruthy()
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle()
}

describe('J1 帯はフォルダ・検索・絞り込みで変わらない（実 Worker の省略形）', () => {
  beforeEach(() => {
    accountState.id = 'acc-1'
    summaryMode = 'full-real'
    stubFetch()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('検索0・解除・友だちなし・フォルダの間、帯は全体のまま', async () => {
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    // 全体: 流入元6件・友だち17人・クリック45回・平均38%。
    expect(kpiText()).toContain('6件')
    expect(kpiText()).toContain('17人')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')
    expect(host.textContent).toContain('春キャンペーン')

    // 検索で0件になっても帯は全体のまま。
    await setSearch('そんざいしないさーち')
    expect(host.textContent).toContain('条件に合う流入経路がありません')
    expect(kpiText()).toContain('6件')
    expect(kpiText()).toContain('17人')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')

    // 検索を消すと一覧が戻り、帯は変わらない。
    await setSearch('')
    expect(host.textContent).toContain('春キャンペーン')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')

    // 友だち追加なし（3行）でも帯は全体のまま。
    await clickButton(host, '友だち追加なし')
    expect(host.textContent).toContain('店頭QR')
    expect(host.textContent).not.toContain('春キャンペーン')
    expect(kpiText()).toContain('6件')
    expect(kpiText()).toContain('17人')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')

    // フォルダ「SNS」を選んでも帯は全体のまま。
    const chips = host.querySelector('[aria-label="流入経路の絞り込み"]')
    expect(chips, '絞り込み欄が見つからない').not.toBeNull()
    await clickButton(chips!, 'すべて')
    const folder = host.querySelector('aside[aria-label="フォルダ"]')
    expect(folder, 'フォルダ欄が見つからない').not.toBeNull()
    await clickButton(folder!, 'SNS')
    expect(host.textContent).toContain('春キャンペーン')
    expect(host.textContent).not.toContain('チラシ')
    expect(kpiText()).toContain('6件')
    expect(kpiText()).toContain('17人')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')
  })

  it('合法の混在形（totalClicksだけ供給）でも検索0で率は全体のまま', async () => {
    summaryMode = 'mixed'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')

    // 検索0でもクリックは45回のまま、率は0%にならない。
    await setSearch('そんざいしないさーち')
    expect(host.textContent).toContain('条件に合う流入経路がありません')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')
  })

  it('供給値が行合計と違う合法形でもsummary優先・分子は全体（90回・19%）', async () => {
    // 行合計45と同値の45だけでは、summary優先が壊れても試験が通ってしまう。
    // 行合計と違う90を供給し、summaryの分母優先と全体範囲の分子を両方見る。
    summaryMode = 'mixed90'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(kpiText()).toContain('90回')
    expect(kpiText()).toContain('19%')

    // 検索0でも供給値90のまま、率は行合計で割り直した値にならない。
    await setSearch('そんざいしないさーち')
    expect(host.textContent).toContain('条件に合う流入経路がありません')
    expect(kpiText()).toContain('90回')
    expect(kpiText()).toContain('19%')
  })

  it('アカウントを変えると帯は別の集計になる', async () => {
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()
    expect(kpiText()).toContain('17人')
    expect(kpiText()).toContain('45回')

    accountState.id = 'acc-2'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(kpiText()).toContain('2件')
    expect(kpiText()).toContain('5人')
    expect(kpiText()).toContain('12回')
    expect(kpiText()).toContain('42%')
    expect(host.textContent).toContain('B春')
  })

  it('実績3行の通常形でも検索・フォルダで全体17/45/38を保持する', async () => {
    // 実 Worker 形（summary.routes 3行・entry-routes 6行）。
    // 6行版の試験は合法補足として別に残している。
    summaryMode = 'real3'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(kpiText()).toContain('6件')
    expect(kpiText()).toContain('17人')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')

    await setSearch('そんざいしないさーち')
    expect(host.textContent).toContain('条件に合う流入経路がありません')
    expect(kpiText()).toContain('6件')
    expect(kpiText()).toContain('17人')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')

    await setSearch('')
    const folder = host.querySelector('aside[aria-label="フォルダ"]')
    expect(folder, 'フォルダ欄が見つからない').not.toBeNull()
    await clickButton(folder!, '代理店')
    expect(host.textContent).toContain('チラシ')
    expect(kpiText()).toContain('6件')
    expect(kpiText()).toContain('17人')
    expect(kpiText()).toContain('45回')
    expect(kpiText()).toContain('38%')
  })

  it('明示のaverageAddRateはfallbackと違ってもsummary優先', async () => {
    // 行から割り直すと38%だが、summary が50と返すときは50を出す。
    summaryMode = 'explicit-rate'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    const cards = kpiCards()
    expect(cards).toHaveLength(4)
    expect(cards[2]).toContain('45回')
    expect(cards[3]).toContain('50%')

    await setSearch('そんざいしないさーち')
    const after = kpiCards()
    expect(after[2]).toContain('45回')
    expect(after[3]).toContain('50%')
  })

  it('集計の取得失敗は0にせず「—」のまま', async () => {
    summaryMode = 'failed'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    // 一覧は読めているので流入元は6件。読めていない3枚は各カードで「—」。
    const cards = kpiCards()
    expect(cards).toHaveLength(4)
    expect(cards[0]).toContain('6件')
    expect(cards[1]).toContain('—')
    expect(cards[1]).not.toContain('17人')
    expect(cards[2]).toContain('—')
    expect(cards[2]).not.toContain('45回')
    expect(cards[2]).not.toContain('0回')
    expect(cards[3]).toContain('—')
    expect(host.textContent).toContain('春キャンペーン')
  })

  it('本物の0クリックは0回と出し、率は「—」', async () => {
    summaryMode = 'zero'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    const cards = kpiCards()
    expect(cards).toHaveLength(4)
    expect(cards[2]).toContain('0回')
    expect(cards[3]).toContain('—')
    expect(cards[3]).not.toContain('0%')
  })
})
