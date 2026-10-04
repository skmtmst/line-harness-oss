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

  /*
   * R193: 保管済みタグ・停止中シナリオは成果承認時に実行できない。
   * 作成画面の候補から外す（案件編集モーダルの #798 と同じ決まり）。
   */
  it('保管済みタグと停止中シナリオは候補に出さない', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const text = String(url)
      if (text.includes('/api/tags')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: [
          { id: 't1', name: '有効タグ', lineAccountId: 'acc-1', status: 'active' },
          { id: 't2', name: '保管済みタグ', lineAccountId: 'acc-1', status: 'archived' },
        ] }) }
      }
      if (text.includes('/api/scenarios')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [
          { id: 's1', name: '有効シナリオ', lineAccountId: 'acc-1', isActive: true },
          { id: 's2', name: '停止シナリオ', lineAccountId: 'acc-1', isActive: false },
        ], total: 2 } }) }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
    }))
    await act(async () => {
      root.render(<NewAffiliateOfferPage />)
    })
    await settle(100)

    const optionLabels = async (buttonId: string) => {
      const switchName = buttonId === 'of-tag' ? 'タグを付ける' : 'シナリオ配信を始める'
  const toggle = host.querySelector<HTMLButtonElement>(`[role=switch][aria-label="${switchName}"]`)
  if (toggle?.getAttribute('aria-checked') === 'false') await act(async () => { toggle.click() })
  const button = host.querySelector<HTMLButtonElement>(`#${buttonId}`)
      expect(button).toBeTruthy()
      await act(async () => { button!.click() })
      // 選択肢は最上層（portal）に出るので document 側を見る。
      const labels = [...document.querySelectorAll('[role="option"]')]
        .map((el) => el.textContent ?? '')
      return labels
    }

    const tagLabels = await optionLabels('of-tag')
    expect(tagLabels.some((text) => text.includes('有効タグ'))).toBe(true)
    expect(tagLabels.some((text) => text.includes('保管済みタグ'))).toBe(false)

    // 開いているメニューを閉じてからシナリオ側を開く。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    const scenarioLabels = await optionLabels('of-scenario')
    expect(scenarioLabels.some((text) => text.includes('有効シナリオ'))).toBe(true)
    expect(scenarioLabels.some((text) => text.includes('停止シナリオ'))).toBe(false)
  })
})
