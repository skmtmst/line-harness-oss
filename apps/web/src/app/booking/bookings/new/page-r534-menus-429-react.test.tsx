// @vitest-environment happy-dom
/*
 * R534 追加残差: メニュー取得の 429 は 503 と同じ文にしない。
 * 混雑の待ち案内と再試行の入口を出すことを本物の React で確かめる。
 *
 * 差し替えるのは通信（bookingApi / api.friends / api.staff.me）と
 * Select・遷移（next/link）だけ。画面の判断は差し替えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const api = vi.hoisted(() => ({
  listMenus: vi.fn(),
  listMenuStaff: vi.fn(),
  getAvailability: vi.fn(),
  getCustomerContext: vi.fn(),
  previewReminders: vi.fn(),
  createProxyBooking: vi.fn(),
  getAlternatives: vi.fn(),
  createCustomer: vi.fn(),
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

const accountId = vi.hoisted(() => ({ value: 'account-ny' }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: accountId.value, accounts: [{ id: accountId.value, name: 'NY店' }] }),
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

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(NewProxyBookingPage)) })
}

async function settle() {
  await act(async () => { await Promise.resolve() })
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await settle()
}

describe('R534: メニュー取得の429は混雑案内と再試行を出す（実React）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/booking/bookings/new')
    staffMe.mockResolvedValue({
      success: true,
      data: { role: 'admin', permissionKeys: [] },
    })
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

  it('429では503と同じ文にせず、待ち秒数と再試行の入口を出す', async () => {
    api.listMenus.mockRejectedValueOnce(
      new ApiError(429, 'API error: 429', 'rate_limited', null, undefined, 30),
    )
    await mount()
    await flush()
    // 混雑の待ち案内（共通の rateLimited 対応文）。
    expect(container.textContent).toContain('混み合っています')
    expect(container.textContent).toContain('30秒ほど待って')
    // 再試行の入口は残す（429は押して直ることがある）。
    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('もう一度読み込む'),
    )
    expect(retry).toBeTruthy()
    // 503と同じだけの文にしない。
    expect(container.textContent).not.toContain('予約メニューを読み込めませんでした')
  })
})
