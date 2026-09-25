// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsMembersPage from './page'

/**
 * #1058: メンバー管理の初回読み込み。
 * `fetchApi` は 4xx/5xx を例外で投げる。生の `Promise.all` だと拒否がそのまま
 * 上がって「運営メンバーを読み込んでいます」のまま固まるので、`opsCall` で
 * 受けてエラー表示＋再読み込みにする契約。
 */

const member = {
  staffId: 's1',
  name: '運営 太郎',
  email: 'ops@example.com',
  isActive: true,
  totpEnabled: true,
  lineLinked: false,
  inviteStatus: 'accepted',
  activationState: 'active',
  invitedAt: null,
  approvedBy: null,
  lastLoginAt: '2026-09-20T10:00:00+09:00',
  createdAt: '2026-09-01T00:00:00+09:00',
}
const summary = {
  members: 1,
  invited: 0,
  awaitingTotp: 0,
  totpEnabled: 1,
  impersonationsThisMonth: 0,
  writeImpersonationsThisMonth: 0,
  piiRevealsThisMonth: 0,
}

let host: HTMLDivElement
let root: Root
let failMembers: boolean

beforeEach(() => {
  failMembers = true
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/ops/members')) {
      return failMembers
        ? new Response(JSON.stringify({ error: 'server' }), { status: 500 })
        : new Response(JSON.stringify({ success: true, data: [member], summary }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/ops/me')) {
      return new Response(JSON.stringify({ success: true, data: { id: 's1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ success: true, data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

describe('運営メンバーの読み込み失敗', () => {
  it('失敗したら「読み込んでいます」や空の案内ではなく、エラーと再読み込みを出す', async () => {
    await act(async () => { root.render(<OpsMembersPage />) })
    await flush()

    expect(host.querySelector('[data-list-state="loading"]')).toBeNull()
    expect(host.querySelector('[data-list-state="empty"]')).toBeNull()
    expect(host.querySelector('[data-list-state="error"]')).not.toBeNull()
    expect(host.textContent).toContain('運営メンバーを表示できませんでした')
    expect(host.textContent).not.toContain('運営メンバーがいません')
  })

  it('再読み込みを押すと読み直して一覧へ戻る', async () => {
    await act(async () => { root.render(<OpsMembersPage />) })
    await flush()

    failMembers = false
    const retry = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('もう一度読み込む'))
    expect(retry).toBeTruthy()
    await act(async () => { retry!.click() })
    await flush()

    expect(host.querySelector('[data-list-state="error"]')).toBeNull()
    expect(host.textContent).toContain('運営 太郎')
    expect(host.textContent).toContain('ops@example.com')
  })
})
