// @vitest-environment happy-dom
/*
 * EMUl9（一覧・閲覧のみ）: staff は変える操作が出ず、帯が出る。
 * 本物のReactで動かして見る。
 * - staff → 帯「閲覧のみで見ています」＋作る・チェック・操作列なし
 * - owner → 帯なし＋作るボタンあり（今までどおり）
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/inflow-links',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

import InflowLinksPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let staffRole: string

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'https://test.invalid')
    const path = url.pathname + url.search
    if (path.startsWith('/api/staff/me')) {
      return new Response(
        JSON.stringify({ success: true, data: { role: staffRole } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

beforeEach(() => {
  staffRole = 'owner'
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

describe('EMUl9 一覧の閲覧のみ', () => {
  it('staffには帯を出し、作る・チェック・操作列を出さない', async () => {
    staffRole = 'staff'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()
    await settle()

    expect(host.textContent).toContain('閲覧のみで見ています。変える操作は管理者に頼んでください。')
    expect(host.textContent).not.toContain('＋ 流入リンクを作る')
    expect(host.querySelector('th [aria-label="表示中の登録済み経路をすべて選ぶ"]')).toBeNull()
    expect(host.textContent).not.toContain('まとめて操作')
  })

  it('ownerには帯を出さず、作るボタンを出す', async () => {
    staffRole = 'owner'
    await act(async () => {
      root.render(<InflowLinksPage />)
    })
    await settle()
    await settle()

    expect(host.textContent).not.toContain('閲覧のみで見ています')
    expect(host.textContent).toContain('＋ 流入リンクを作る')
  })
})
