// @vitest-environment happy-dom
/*
 * 板 `FvbHW` メンバー管理の絵合わせ（V8）。
 * - 頭：説明、段切り替えは運営メンバー・情報
 * - 数の帯：3つ（2要素認証の札は出さない）、有効・招待中と監査ログに記録
 * - 招待の行が常に出る（開閉ボタン・キャンセルは無い）
 * - 行：（自分）、2要素認証待ちの札、短い最終ログイン
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsMembersPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

const members = [
  { staffId: 's1', name: 'Kenta Kawano', email: 'kenta@musubo.jp', isActive: true, totpEnabled: true, lineLinked: false, inviteStatus: '', activationState: 'active', invitedAt: null, approvedBy: null, lastLoginAt: '2026-10-02T07:10:00.000+09:00', createdAt: '2026-09-01T00:00:00.000+09:00' },
  { staffId: 's2', name: '坂本 正人', email: 'sakamoto@musubo.jp', isActive: true, totpEnabled: true, lineLinked: false, inviteStatus: '', activationState: 'active', invitedAt: null, approvedBy: null, lastLoginAt: '2026-10-01T22:40:00.000+09:00', createdAt: '2026-09-01T00:00:00.000+09:00' },
  { staffId: 's3', name: '山田 花子', email: 'yamada@musubo.jp', isActive: true, totpEnabled: false, lineLinked: false, inviteStatus: '', activationState: 'awaiting_totp', invitedAt: '2026-10-03T00:00:00.000+09:00', approvedBy: null, lastLoginAt: null, createdAt: '2026-10-03T00:00:00.000+09:00' },
]

const summary = { members: 3, invited: 1, awaitingTotp: 1, totpEnabled: 2, impersonationsThisMonth: 1, writeImpersonationsThisMonth: 1, piiRevealsThisMonth: 0 }

let host: HTMLDivElement
let root: Root

function text(): string {
  return host.textContent ?? ''
}

async function settle(turns = 8) {
  for (let i = 0; i < turns; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.endsWith('/api/ops/me')
      ? { success: true, data: { id: 's1' } }
      : { success: true, data: members, summary }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

describe('FvbHW メンバー管理の絵合わせ', () => {
  it('頭・帯・招待・行が絵どおり', async () => {
    await act(async () => { root.render(<OpsMembersPage />) })
    await settle()
    const body = text()
    expect(body).toContain('招待された人はパスワードを設定し')
    expect(body).toContain('運営メンバー')
    expect(body).toContain('運営の情報')
    expect(body).not.toContain('権限者')
    expect(body).toContain('有効 2・招待中 1')
    expect(body).toContain('監査ログに記録')
    expect(body).not.toContain('未設定 1人')
    // 招待の行
    expect(body).toContain('招待メールを送る')
    expect(body).not.toContain('運営メンバーを招待')
    expect(body).not.toContain('キャンセル')
    // 行
    expect(body).toContain('Kenta Kawano（自分）')
    expect(body).toContain('10/2 07:10')
    expect(body).toContain('10/1 22:40')
    expect(body).toContain('2要素認証待ち')
    expect(body).toContain('招待中')
    expect(body).toContain('停止')
  })
})
