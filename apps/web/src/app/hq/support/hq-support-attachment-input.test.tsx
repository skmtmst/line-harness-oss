// @vitest-environment happy-dom
/**
 * 問い合わせの画像添付の裏の input（sr-only = 1px）は、見えない入力欄
 * として検出される。裏の input は出さない（hidden）。
 * 開くのは「クリックして画像を選ぶ」ボタンからのまま変えないことが約束。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  context: vi.fn(async () => ({
    success: true,
    data: {
      kinds: [{ key: 'billing', label: '料金・契約について' }],
      accounts: [{ id: 'line-1', name: '表参道店' }],
      sender: { tenantName: '株式会社サンプル', name: '山田 太郎', email: 'owner@example.com', planLabel: 'スタンダード' },
    },
  })),
  list: vi.fn(async () => ({ success: true, data: [] })),
  create: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: { hqSupport: calls } }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageChrome: () => ({}) }))
vi.mock('@/components/tenant-access-context', () => ({ useTenantStatus: () => 'active' }))
vi.mock('@/components/hq/notice-line-register-dialog', () => ({ default: () => <div data-line-guide /> }))

import HqSupportPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

describe('問い合わせの添付 input は出さない（m22a）', () => {
  beforeEach(() => {
    calls.context.mockClear()
    calls.list.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('file input は hidden・読み上げ対象外で、選ぶボタンがある', async () => {
    await act(async () => { root.render(<HqSupportPage />) })
    await settle()
    const input = host.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!input) throw new Error('file input がありません')
    expect(input.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(input.getAttribute('aria-hidden')).toBe('true')
    expect(
      [...host.querySelectorAll('button')].some((button) =>
        (button.textContent ?? '').includes('クリックして画像を選ぶ'),
      ),
    ).toBe(true)
  })
})
