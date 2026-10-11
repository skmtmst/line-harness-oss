// @vitest-environment happy-dom
/*
 * #980: 流入と計測のタブ件数が、一覧と同じ集計に連動することを
 * 本物のReactで動かして見る。
 *
 * 以前は「流入経路 24」「広告連携 3」「広告とのつなぎ 5」が設計の写しの
 * 固定値で、一覧が0件のアカウントでもそのまま出ていた。
 * - 「流入経路」は一覧が数える accountFilteredRows と同じ総数
 * - 「広告連携」「広告とのつなぎ」は広告タブが取得する ad-platforms の集計
 * - データが変われば数字も変わり、取得が終わるまでは数字を出さない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentParams = ''

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  usePathname: () => '/inflow-links',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(currentParams),
}))

import InflowLinksPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let handler: (path: string) => Promise<unknown> | unknown

function route(id: string, refCode: string) {
  return {
    id,
    refCode,
    genre: null,
    name: `流入元 ${refCode}`,
    tagId: null,
    scenarioId: null,
    redirectUrl: null,
    poolId: null,
    introTemplateId: null,
    runAccountFriendAddScenarios: true,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function platform(id: string, isActive: boolean) {
  return {
    id,
    name: id,
    displayName: id,
    config: {},
    isActive,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const EMPTY_REF_SUMMARY = {
  routes: [],
  totalFriends: 0,
  friendsWithRef: 0,
  friendsWithoutRef: 0,
}

function baseHandler(routes: unknown[], platforms: unknown[] = []) {
  return async (path: string) => {
    if (path.startsWith('/api/settings/features/visibility')) {
      return { success: true, data: { features: { inflow_tracking: true, site_tracking: true } } }
    }
    if (path.startsWith('/api/entry-routes')) return { success: true, data: routes }
    // api.scenarios.list は口の { items } を配列へ読み替えるので、器ごと返す。
    if (path.startsWith('/api/scenarios')) {
      return { success: true, data: { items: [], total: 0, limit: 200, sort: [] } }
    }
    if (path.startsWith('/api/analytics/ref-summary')) {
      return { success: true, data: EMPTY_REF_SUMMARY }
    }
    if (path.startsWith('/api/ad-platforms/logs')) {
      return { success: true, data: { items: [], total: 0, page: 1, limit: 20, sort: [] } }
    }
    if (path.startsWith('/api/ad-platforms')) return { success: true, data: platforms }
    if (path.startsWith('/api/ad-costs')) {
      return { success: true, data: { rows: [], platforms: [] } }
    }
    return { success: true, data: [] }
  }
}

function kpiCards(): string[] { return [...host.querySelectorAll('[data-shared-part="kpi-band"] > *')].map(el => el.textContent ?? '') }

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

describe('#980 流入と計測のタブ件数は一覧の集計に連動する', () => {
  beforeEach(() => {
    currentParams = ''
    handler = baseHandler([])
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const raw = typeof input === 'string' ? input : String(input)
      const path = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw
      const body = await handler(path)
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
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

  it('「流入経路」の件数は一覧の総数と同じ', async () => {
    handler = baseHandler([route('er-1', 'summer-ig'), route('er-2', 'tanaka01')])

    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(kpiCards()[0]).toContain('2件')
    // 広告タブはまだ開いていないので、取得前の数字は出さない。
    expect(host.querySelector('[data-scrollable-tabs]')).toBeNull()
    expect(kpiCards()[3]).toContain('0件')
  })

  it('一覧が0件なら数の帯も0と出る', async () => {
    handler = baseHandler([])

    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(kpiCards()[0]).toContain('0件')
  })

  it('取得が終わるまでは件数を出さない', async () => {
    // 応答が返らないままの状態では、タブに数字を付けない。
    handler = () => new Promise(() => {})

    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(kpiCards()[0]).toContain('読み込んでいます')
    expect(kpiCards()[0]).not.toContain('0件')
  })

  it('広告の接続数と各媒体の状態は ad-platforms の集計と同じ', async () => {
    currentParams = 'tab=ads'
    handler = baseHandler(
      [],
      [platform('meta', true), platform('google', true), platform('x', false)],
    )

    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(kpiCards()[1]).toContain('2件')
    const rows = [...host.querySelectorAll('[aria-label="媒体ごとの接続"] [role="listitem"]')]
    expect(rows.filter(row => row.textContent?.includes('つないでいる'))).toHaveLength(2)
    expect(rows.filter(row => row.textContent?.includes('未接続'))).toHaveLength(2)
  })
})
