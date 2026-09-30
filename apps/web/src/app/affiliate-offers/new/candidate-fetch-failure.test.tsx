// @vitest-environment happy-dom
/*
 * R524: 案件作成でタグ・シナリオの候補取得に失敗したら「（なし）」に
 * 化けさせず、失敗と再試行を出す。取り直すまで保存させない。
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
let failTags: boolean
let failScenarios: boolean

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const text = String(url)
    if (text.includes('/api/tags')) {
      if (failTags) throw new Error('network down')
      return { ok: true, status: 200, json: async () => ({ success: true, data: [
        { id: 't1', name: '購入者タグ', lineAccountId: 'acc-1', status: 'active' },
      ] }) }
    }
    if (text.includes('/api/scenarios')) {
      if (failScenarios) throw new Error('network down')
      return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [
        { id: 's1', name: '案内シナリオ', lineAccountId: 'acc-1', isActive: true },
      ], total: 1 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
  }))
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

function setInput(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)
  expect(input).toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input!.dispatchEvent(new Event('input', { bubbles: true }))
}

async function openOptions(buttonId: string) {
  const button = host.querySelector<HTMLButtonElement>(`#${buttonId}`)
  expect(button).toBeTruthy()
  await act(async () => { button!.click() })
  return [...document.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? '')
}

describe('R524 候補の取得失敗は空と区別して再試行を出す', () => {
  beforeEach(() => {
    failTags = false
    failScenarios = false
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

  it('タグだけ失敗したらタグ側に失敗と再試行が出て、シナリオ側には出ない', async () => {
    failTags = true
    await act(async () => {
      root.render(<NewAffiliateOfferPage />)
    })
    await settle(100)
    expect(host.textContent).toContain('タグの候補を読み込めませんでした')
    expect(host.textContent).not.toContain('シナリオの候補を読み込めませんでした')
    expect(host.textContent).toContain('もう一度読み込む')
  })

  it('回復後の再試行で候補が復帰する', async () => {
    failTags = true
    await act(async () => {
      root.render(<NewAffiliateOfferPage />)
    })
    await settle(100)
    expect(host.textContent).toContain('タグの候補を読み込めませんでした')

    failTags = false
    const retry = [...host.querySelectorAll('button')].find((el) => el.textContent === 'もう一度読み込む')
    expect(retry).toBeTruthy()
    await act(async () => {
      retry!.click()
    })
    await settle(100)
    expect(host.textContent).not.toContain('タグの候補を読み込めませんでした')
    const labels = await openOptions('of-tag')
    expect(labels.some((text) => text.includes('購入者タグ'))).toBe(true)
  })

  it('正常な0件は失敗表示にならない', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const text = String(url)
      if (text.includes('/api/tags')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
      }
      if (text.includes('/api/scenarios')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [], total: 0 } }) }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
    }))
    await act(async () => {
      root.render(<NewAffiliateOfferPage />)
    })
    await settle(100)
    expect(host.textContent).not.toContain('タグの候補を読み込めませんでした')
    expect(host.textContent).not.toContain('シナリオの候補を読み込めませんでした')
    expect(host.textContent).not.toContain('もう一度読み込む')
  })

  it('失敗中は保存が止まる', async () => {
    failScenarios = true
    await act(async () => {
      root.render(<NewAffiliateOfferPage />)
    })
    await settle(100)
    await act(async () => {
      setInput('of-name', 'テスト案件')
      setInput('of-amount', '1000')
    })
    const save = [...host.querySelectorAll('button')].find((el) => el.textContent === '公開する')
    expect(save).toBeTruthy()
    await act(async () => {
      save!.click()
    })
    await settle(100)
    expect(host.textContent).toContain('候補を読み込めませんでした')
  })
})
