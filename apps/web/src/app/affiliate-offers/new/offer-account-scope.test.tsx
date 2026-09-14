// @vitest-environment happy-dom
/*
 * N-211: 案件作成で選ぶタグ・シナリオが選択accountで絞られることを、
 * 本物のReactで動かして見る。一覧取得のURLに選択accountが付くこと。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

import NewAffiliateOfferPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const fetchUrls: string[] = []

function stubFetch() {
  fetchUrls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    fetchUrls.push(String(url).split('?')[0] + '?' + String(url).split('?').slice(1).join('?'))
    const text = String(url)
    if (text.includes('/api/tags')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
    }
    if (text.includes('/api/scenarios')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [], total: 0 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
  }))
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

describe('N-211 案件作成の選択肢は選択accountで絞る', () => {
  beforeEach(() => {
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

  it('タグ・シナリオ一覧の取得に選択accountが付く', async () => {
    await act(async () => {
      root.render(<NewAffiliateOfferPage />)
    })
    await settle(100)
    const tagUrls = fetchUrls.filter((url) => url.includes('/api/tags'))
    const scenarioUrls = fetchUrls.filter((url) => url.includes('/api/scenarios'))
    expect(tagUrls.length).toBeGreaterThan(0)
    expect(scenarioUrls.length).toBeGreaterThan(0)
    for (const url of [...tagUrls, ...scenarioUrls]) {
      expect(url).toContain('acc-1')
    }
  })
})
