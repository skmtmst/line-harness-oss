// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  accounts: vi.fn(),
  lastLogins: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    staff: {
      me: mocks.me,
      list: mocks.list,
      update: mocks.update,
      lastLogins: mocks.lastLogins,
    },
    lineAccounts: {
      list: mocks.accounts,
    },
  },
  ApiError: class MockApiError extends Error {
    readonly status: number
    readonly code?: string
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

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは変える前の確認なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options, disabled }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
    disabled?: boolean
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

import HqMembersPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 統括メンバーの権限変更は V8-B 板 `M4jS9` の確認を通してから変える。
 * 役割の変更前→変更後と「変わる」が出て、変えると保存口へ送る。再発防止。
 */

const me = {
  id: 'me-1', name: '自分', email: 'me@example.com', role: 'owner', lineLinked: false,
  twoFactorEnabled: false, isActive: true, permissionKeys: [], notificationPreferences: {},
  inviteStatus: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  assignedLineAccountId: null, canAccessDescendantAccounts: false,
}

const member = {
  ...me, id: 's-1', name: '佐藤 直人', email: 'sato@example.com', role: 'admin',
  accountScope: 'all', scopedLineAccountIds: [],
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  mocks.me.mockResolvedValue({ success: true, data: me })
  mocks.list.mockResolvedValue({ success: true, data: [me, member] })
  mocks.accounts.mockResolvedValue({ success: true, data: [] })
  mocks.lastLogins.mockResolvedValue({ success: true, data: {} })
  mocks.update.mockResolvedValue({ success: true, data: {} })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.querySelectorAll('[data-design-node="M4jS9"]').forEach((node) => node.remove())
  vi.clearAllMocks()
})

async function flush() {
  for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve() })
}

describe('権限を変える確認（板 M4jS9）', () => {
  it('変える前に変更前→変更後を見せてから保存口へ送る', async () => {
    await act(async () => { root.render(<HqMembersPage />) })
    await flush()
    const change = host.querySelector('button[aria-label="佐藤 直人さんの権限を変更"]')
    expect(change, '権限を変更ボタンがない').not.toBeNull()
    await act(async () => { (change as HTMLButtonElement).click() })
    await flush()
    // 役割を管理者から閲覧のみへ変える。
    const role = document.body.querySelector('select[aria-label="役割"]') as HTMLSelectElement | null
    expect(role, '役割の選択がない').not.toBeNull()
    await act(async () => {
      role!.value = 'viewer'
      role!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const save = Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === '変更を保存')
    expect(save, '変更を保存ボタンがない').not.toBeUndefined()
    await act(async () => { (save as HTMLButtonElement).click() })
    await flush()
    // 保存口へはまだ送らず、確認の小窓が出る。
    expect(mocks.update).not.toHaveBeenCalled()
    const confirm = document.body.querySelector('[data-design-node="M4jS9"]')
    expect(confirm, '確認の小窓が出ない').not.toBeNull()
    for (const row of ['佐藤 直人さんの権限を変えますか？', '役割', '管理者 → 閲覧のみ', '変わる']) {
      expect(confirm?.textContent ?? '', `「${row}」がない`).toContain(row)
    }
    const go = Array.from(confirm?.querySelectorAll('button') ?? []).find((b) => (b.textContent ?? '').trim() === '変える')
    await act(async () => { (go as HTMLButtonElement).click() })
    await flush()
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ role: 'viewer' })
  })
})
