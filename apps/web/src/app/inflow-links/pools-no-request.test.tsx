// @vitest-environment happy-dom
/*
 * Issue #703: 流入リンクの3画面はプールを補助データとして読む。
 * multi_store_hierarchy が off なら GET /api/traffic-pools を発行せず
 * （403 が console error になるため）、画面自体は止めない。
 * on なら従来どおり呼ぶ。本物のReactで見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentParams = ''

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {} }),
  useSearchParams: () => new URLSearchParams(currentParams),
}))

import InflowLinksPage from './page'
import NewInflowLinkPage from './new/page'
import InflowLinkDetailPage from './detail/page'
import { clearFeatureVisibilityCache } from '@/lib/feature-visibility-cache'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const fetchUrls: string[] = []
let features: Record<string, boolean> = {}

function stubFetch() {
  fetchUrls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const href = String(url)
    fetchUrls.push(href)
    if (href.includes('/api/settings/features/visibility')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { features } }) }
    }
    if (href.includes('/api/line-accounts')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: [{ id: 'acc-1', name: '本店' }] }) }
    }
    if (href.includes('/api/scenarios')) {
      // api.scenarios.list は data.items を配列へ読み替える。
      return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [], total: 0, limit: 200, sort: [] } }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
  }))
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

function mount(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  return act(async () => {
    root.render(node)
  })
}

describe('流入リンクのプール取得ゲート（#703）', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
    clearFeatureVisibilityCache()
    currentParams = ''
    features = {}
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('一覧：off ならプール口を呼ばず、一覧は出す', async () => {
    features = { multi_store_hierarchy: false, inflow_tracking: true }
    stubFetch()
    await mount(<InflowLinksPage />)
    await settle(300)

    expect(host.textContent).toContain('流入経路')
    expect(fetchUrls.some((u) => u.includes('/api/traffic-pools'))).toBe(false)
  })

  it('一覧：on ならプール口を呼ぶ', async () => {
    features = { multi_store_hierarchy: true, inflow_tracking: true }
    stubFetch()
    await mount(<InflowLinksPage />)
    await settle(300)

    expect(host.textContent).toContain('流入経路')
    expect(fetchUrls.some((u) => u.includes('/api/traffic-pools'))).toBe(true)
  })

  it('新規作成：off ならプール口を呼ばず、画面は出す', async () => {
    features = { multi_store_hierarchy: false }
    stubFetch()
    await mount(<NewInflowLinkPage />)
    await settle(300)

    expect(host.textContent).toContain('メインプールで自動振り分け')
    expect(fetchUrls.some((u) => u.includes('/api/traffic-pools'))).toBe(false)
  })

  it('新規作成：on ならプール口を呼ぶ', async () => {
    features = { multi_store_hierarchy: true }
    stubFetch()
    await mount(<NewInflowLinkPage />)
    await settle(300)

    expect(host.textContent).toContain('メインプールで自動振り分け')
    expect(fetchUrls.some((u) => u.includes('/api/traffic-pools'))).toBe(true)
  })

  it('詳細：off ならプール口を呼ばない', async () => {
    features = { multi_store_hierarchy: false }
    stubFetch()
    await mount(<InflowLinkDetailPage />)
    await settle(300)

    expect(fetchUrls.some((u) => u.includes('/api/traffic-pools'))).toBe(false)
  })

  it('詳細：on ならプール口を呼ぶ', async () => {
    features = { multi_store_hierarchy: true }
    stubFetch()
    await mount(<InflowLinkDetailPage />)
    await settle(300)

    expect(fetchUrls.some((u) => u.includes('/api/traffic-pools'))).toBe(true)
  })
})
