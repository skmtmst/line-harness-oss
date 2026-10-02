// @vitest-environment happy-dom
/*
 * #859: site_tracking が流入計測の画面と一致することを本物のReactで見る。
 * - off で「サイトスクリプト」タブが出ない
 * - ?tab=script の直URLでも本文へ進まず停止画面を出す
 * - on なら従来どおりタブが出て計測APIを呼ぶ
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
import { clearFeatureVisibilityCache } from '@/lib/feature-visibility-cache'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const fetchUrls: string[] = []

function stubFetch(features: Record<string, boolean>) {
  fetchUrls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const href = String(url)
    fetchUrls.push(href)
    if (href.includes('/api/settings/features/visibility')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { features } }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
  }))
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

const ALL_ON: Record<string, boolean> = { site_tracking: true, inflow_tracking: true }

describe('site_tracking の画面ゲート(#859)', () => {
  beforeEach(() => {
    // 表示可否は画面間で共有される（V6R-S0-b）。試験ごとに応答を替えるので毎回捨てる。
    clearFeatureVisibilityCache()
    stubFetch(ALL_ON)
    currentParams = ''
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

  it('onのときサイトスクリプトのタブが出て、?tab=script で計測APIを呼ぶ', async () => {
    currentParams = 'tab=script'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle(200)

    expect(host.textContent).toContain('サイトスクリプト')
    expect(host.querySelector('[data-feature-disabled]')).toBeNull()
    expect(fetchUrls.some((u) => u.includes('/api/site/summary'))).toBe(true)
  })

  it('offのときサイトスクリプトのタブが消え、他のタブは残る', async () => {
    stubFetch({ site_tracking: false, inflow_tracking: true })
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle(200)

    expect(host.textContent).not.toContain('サイトスクリプト')
    expect(host.textContent).toContain('流入経路')
    expect(host.textContent).toContain('広告連携')
  })

  it('offで ?tab=script の直URLは停止画面へ切り替わり、計測APIを呼ばない', async () => {
    stubFetch({ site_tracking: false, inflow_tracking: true })
    currentParams = 'tab=script'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle(200)

    expect(host.querySelector('[data-feature-disabled="site_tracking"]')).not.toBeNull()
    expect(fetchUrls.some((u) => u.includes('/api/site/summary'))).toBe(false)
    expect(fetchUrls.some((u) => u.includes('/api/site/pages'))).toBe(false)
  })
})
