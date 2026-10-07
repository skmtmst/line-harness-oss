// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

/*
 * ★V8 権限なし（板 O5tUeE）。
 * - 板：題・説明・鍵の札。分からない役割・管理者は出さない
 * - シナリオ配信の一覧は、一覧の口が 403 のときだけ画面ごとこの板になる（500 は今までの「読み込めませんでした」）
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/scenarios',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: { id: 'acc-1', name: '店舗A' }, loading: false }),
}))

import NoPermissionBoard from './no-permission'
import ScenariosListV8 from '@/v8/scenarios/list'

describe('権限なしの板', () => {
  it('役割が分かれば札に出し、分からない管理者・要る役割は断定しない', () => {
    const html = renderToStaticMarkup(<NoPermissionBoard featureName="シナリオ配信" roleLabel="スタッフ" capabilitiesHref="/staff" />)
    expect(html).toContain('data-design-node="O5tUeE"')
    expect(html).toContain('シナリオ配信を開く権限がありません')
    expect(html).toContain('いまの役割は「スタッフ」です。必要なら、管理者に役割の変更を頼んでください。')
    expect(html).not.toContain('管理者：')
    expect(html).not.toContain('以上の役割で使えます')
    expect(html).toContain('役割でできることを見る')
  })

  it('役割も分からなければ役割の行を出さない', () => {
    const html = renderToStaticMarkup(<NoPermissionBoard featureName="シナリオ配信" />)
    expect(html).not.toContain('いまの役割')
    expect(html).not.toContain('役割でできることを見る')
    expect(html).toContain('ダッシュボードへ戻る')
  })
})

describe('シナリオ配信の一覧', () => {
  let root: Root
  let host: HTMLDivElement
  let status = 403
  const store = new Map<string, string>()

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) }, clear: () => store.clear() },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/scenarios')) {
        return new Response(JSON.stringify({ success: false, error: 'この操作の権限がありません' }), { status, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/staff/me')) {
        return new Response(JSON.stringify({ success: true, data: { id: 's-1', name: '受付の人', role: 'staff', email: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      // 数の帯・フォルダなどは、この試験では読めなかったことにする（一覧の口だけを見る）。
      return new Response(JSON.stringify({ success: false, error: 'not mocked' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    store.clear()
    vi.unstubAllGlobals()
  })

  async function render() {
    await act(async () => { root.render(<ScenariosListV8 />) })
    for (let i = 0; i < 15; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }

  it('一覧の口が 403 なら権限なしの板（いまの役割つき）にする', async () => {
    status = 403
    await render()
    expect(host.querySelector('[data-design-node="O5tUeE"]')).not.toBeNull()
    expect(host.textContent).toContain('いまの役割は「スタッフ」です。')
  })

  it('500 は権限なしにしない', async () => {
    status = 500
    await render()
    expect(host.querySelector('[data-design-node="O5tUeE"]')).toBeNull()
  })
})
