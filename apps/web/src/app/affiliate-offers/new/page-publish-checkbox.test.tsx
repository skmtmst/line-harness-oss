// @vitest-environment happy-dom
/*
 * 案件作成の公開切り替えが★V7の共通チェックボックスであること。
 * 素の <input type="checkbox"> ではなく、文字を押しても切り替わり、
 * ON/OFFで保存ボタンの表示（公開する／下書きに保存）が変わる。
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

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const text = String(url)
    if (text.includes('/api/scenarios')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [], total: 0 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
  }))
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

function checkbox(): HTMLInputElement {
  const found = host.querySelector('input[type="checkbox"]')
  if (!found) throw new Error('checkbox が見つかりません')
  return found as HTMLInputElement
}

describe('案件作成の公開切り替え', () => {
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

  it('共通部品のチェックボックスで、文字を押しても切り替わる', async () => {
    await act(async () => {
      root.render(<NewAffiliateOfferPage />)
    })
    await settle(50)
    const box = checkbox()
    expect(box.checked).toBe(true)
    // 文字（label）を押しても切り替わる＝共通部品の結びつき。
    const label = [...host.querySelectorAll('label')].find((el) =>
      el.textContent?.includes('作成したらすぐ公開する'),
    )
    expect(label?.textContent).toContain('作成したらすぐ公開する')
    await act(async () => {
      label?.click()
    })
    expect(checkbox().checked).toBe(false)
  })

  it('OFFにすると保存ボタンが「下書きに保存」に変わる', async () => {
    await act(async () => {
      root.render(<NewAffiliateOfferPage />)
    })
    await settle(50)
    expect(host.textContent).toContain('公開する')
    await act(async () => {
      checkbox().click()
    })
    expect(host.textContent).toContain('下書きに保存')
  })
})
