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

vi.mock('next/navigation', () => ({
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
    return { success: true, data: [] }
  }
}

/** タブ行（ScrollableTabs）の各タブの文字だけを集める。本文中の語と混ぜない。 */
function tabTexts(): string[] {
  return Array.from(
    host.querySelectorAll('[data-scrollable-tabs] button, [data-scrollable-tabs] a'),
  ).map((el) => el.textContent ?? '')
}

function tabLabel(prefix: string): string | undefined {
  return tabTexts().find((text) => text.startsWith(prefix))
}

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

    expect(tabLabel('流入経路')).toBe('流入経路 2')
    // 広告タブはまだ開いていないので、取得前の数字は出さない。
    expect(tabLabel('広告連携')).toBe('広告連携')
    expect(tabLabel('広告とのつなぎ')).toBe('広告とのつなぎ')
  })

  it('一覧が0件ならタブも0と出る', async () => {
    handler = baseHandler([])

    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(tabLabel('流入経路')).toBe('流入経路 0')
  })

  it('取得が終わるまでは件数を出さない', async () => {
    // 応答が返らないままの状態では、タブに数字を付けない。
    handler = () => new Promise(() => {})

    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(tabLabel('流入経路')).toBe('流入経路')
  })

  it('広告タブの件数は ad-platforms の集計と同じ', async () => {
    currentParams = 'tab=ads'
    handler = baseHandler(
      [],
      [platform('meta', true), platform('google', true), platform('x', false)],
    )

    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()

    expect(tabLabel('広告連携')).toBe('広告連携 3')
    expect(tabLabel('広告とのつなぎ')).toBe('広告とのつなぎ 2')
  })
})
