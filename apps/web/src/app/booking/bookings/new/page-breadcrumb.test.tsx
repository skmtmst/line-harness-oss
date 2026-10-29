// @vitest-environment happy-dom
/*
 * B13: 電話の予約を入れる画面にパンくずを2つ出さない。
 * 上の帯のパンくず（外側）が正で、画面の中に手書きの現在位置ナビを置かない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listMenus: vi.fn(),
  listMenuStaff: vi.fn(),
  getAvailability: vi.fn(),
  getCustomerContext: vi.fn(),
  previewReminders: vi.fn(),
}))

const friendsList = vi.hoisted(() => vi.fn())
const staffMe = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    bookingApi: api,
    api: {
      ...actual.api,
      friends: { ...actual.api.friends, list: friendsList },
      staff: { ...actual.api.staff, me: staffMe },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-ny', accounts: [{ id: 'account-ny', name: 'NY店' }] }),
}))

vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label': string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

import NewProxyBookingPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

describe('電話予約: パンくずの重複なし（B13）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    staffMe.mockResolvedValue({ success: true, data: { role: 'admin', permissionKeys: [] } })
    api.listMenus.mockResolvedValue({ menus: [] })
    api.listMenuStaff.mockResolvedValue({ staff: [] })
    api.getAvailability.mockResolvedValue({ by_staff: [] })
    api.getCustomerContext.mockResolvedValue({ customer: null })
    api.previewReminders.mockResolvedValue({ reminders: [] })
    friendsList.mockResolvedValue({ success: true, data: { items: [] } })
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
  })

  it('画面の中に現在位置ナビを置かない（上の帯のパンくずだけ）', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(React.createElement(NewProxyBookingPage)) })
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() })
    expect(container.querySelector('h1')?.textContent).toContain('電話の予約を入れる')
    expect(container.querySelector('nav[aria-label="現在位置"]')).toBeNull()
  })
})
