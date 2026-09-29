// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsTenantDetailPage from './page'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=t1') }))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 契約先の詳細「概要」タブ。1440px の撮影で「契約先の情報」「契約の状況」の
 * 行が見出しと同じ左端に付かず、最後の「機能パック」が下端で切れていた。
 * 行の入れ物に見出しと同じ横の余白と下の余白を持たせた。再発防止。
 */

const payload = {
  tenant: {
    id: 't1', name: '検証商事', status: 'active', featurePacks: ['予約'],
    plan_key: 'standard', plan_status: 'active', trial_ends_at: null,
    current_period_ends_at: '2026-10-01T00:00:00+09:00',
    created_at: '2026-04-01T10:00:00+09:00', updated_at: '2026-09-01T10:00:00+09:00',
    account_count: 1, staff_count: 1, last_login_at: '2026-09-07T08:00:00+09:00',
  },
  accounts: [
    { id: 'a1', name: '画面確認アカウント', is_active: 1, archived_at: null, updated_at: '2026-09-01T10:00:00+09:00', friend_count: 231 },
  ],
  members: [
    { id: 's1', name: '検証 一郎', email: null, role: 'owner', access_level: 'admin', is_active: 1, invite_status: 'accepted', last_login_at: '2026-09-07T08:00:00+09:00' },
  ],
  audit: [],
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/ops/tenants/t1')) {
      return new Response(JSON.stringify({ success: true, data: payload }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ success: false, error: `unexpected ${url}` }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

describe('契約先の詳細の概要', () => {
  it('2つのカードの見出しと行（統括名〜機能パック）が出る', async () => {
    await act(async () => { root.render(<OpsTenantDetailPage />) })
    await flush()
    const text = host.textContent ?? ''
    expect(text).toContain('契約先の情報')
    expect(text).toContain('契約の状況')
    for (const row of ['統括名', '登録日', '店舗数', '権限者数', '最終ログイン', '機能パック']) {
      expect(text, `行「${row}」がない`).toContain(row)
    }
    expect(text).toContain('検証商事')
  })

  it('行の入れ物は見出しと同じ横の余白と下の余白を持つ', async () => {
    await act(async () => { root.render(<OpsTenantDetailPage />) })
    await flush()
    const lists = Array.from(host.querySelectorAll('dl'))
    expect(lists.length).toBe(2)
    for (const dl of lists) {
      expect(dl.className).toContain('px-4')
      expect(dl.className).toContain('pb-4')
    }
  })
})
