// @vitest-environment happy-dom
/*
 * M025: 範囲限定の担当者は権限者の一覧を見ず、理由の分かる面が出る。
 * 先に自分を読んで範囲限定と分かれば、通らない一覧は呼ばない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  list: vi.fn(),
  accounts: vi.fn(),
  lastLogins: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    staff: {
      me: mocks.me,
      list: mocks.list,
      lastLogins: mocks.lastLogins,
    },
    lineAccounts: {
      list: mocks.accounts,
    },
  },
  ApiError: class MockApiError extends Error {
    readonly status: number
    constructor(status: number, message?: string) {
      super(message ?? `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
    }
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: vi.fn(),
}))

import HqMembersPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const meBase = {
  id: 'me-1',
  name: '自分',
  email: 'me@example.com',
  role: 'staff',
  lineLinked: false,
  twoFactorEnabled: false,
  isActive: true,
  permissionKeys: [],
  notificationPreferences: {},
  inviteStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  assignedLineAccountId: null,
  canAccessDescendantAccounts: false,
} as const

let host: HTMLDivElement
let root: Root

async function renderPage() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<HqMembersPage />)
  })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

describe('M025 範囲限定は一覧を呼ばず理由を出す', () => {
  it('範囲限定なら一覧を呼ばず、理由の面が出る', async () => {
    mocks.me.mockResolvedValue({ success: true, data: { ...meBase, accountScope: 'accounts', scopedLineAccountIds: ['acc-1'] } })
    await renderPage()
    expect(host.textContent).toContain('担当アカウントが限定されているため')
    expect(mocks.list).not.toHaveBeenCalled()
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('全店舗なら一覧を呼ぶ', async () => {
    mocks.me.mockResolvedValue({ success: true, data: { ...meBase, role: 'owner', accountScope: 'all' } })
    mocks.list.mockResolvedValue({ success: true, data: [] })
    mocks.accounts.mockResolvedValue({ success: true, data: [] })
    mocks.lastLogins.mockResolvedValue({ success: true, data: {} })
    await renderPage()
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain('担当アカウントが限定されているため')
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
