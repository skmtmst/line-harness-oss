// @vitest-environment happy-dom
/*
 * 73: 作る画面のパンくずは上の帯だけ。板の中に2つ目のパンくず（下線の文字・区切り）を置かない。
 * 電話の予約を入れる：題は共通の PageHeading、戻り先は上の帯のパンくず（予約管理）へ。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const crumbsFn = vi.hoisted(() => vi.fn())
const titleFn = vi.hoisted(() => vi.fn())

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: (...args: unknown[]) => titleFn(...args),
  usePageCrumbs: (...args: unknown[]) => crumbsFn(...args),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: 'A店' }] }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    bookingApi: {
      listMenus: vi.fn(async () => ({ menus: [] })),
      listMenuStaff: vi.fn(async () => ({ staff: [] })),
      getAvailability: vi.fn(async () => ({ by_staff: [] })),
      getCustomerContext: vi.fn(async () => ({ customer: null })),
      previewReminders: vi.fn(async () => ({ reminders: [] })),
    },
    api: {
      ...actual.api,
      friends: { ...actual.api.friends, list: vi.fn(async () => ({ success: true, data: [] })) },
      staff: { ...actual.api.staff, me: vi.fn(async () => ({ success: true, data: { role: 'admin', permissionKeys: [] } })) },
    },
  }
})

import NewProxyBookingPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root | null = null

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(React.createElement(NewProxyBookingPage)) })
  await act(async () => { await Promise.resolve() })
}

describe('73 電話の予約を入れる：板の中にパンくずを置かない', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })
  afterEach(() => {
    if (root) { act(() => { root!.unmount() }); root = null }
    container?.remove()
  })

  it('題は共通の見出しで、板の中に2つ目のパンくずが無い', async () => {
    await mount()
    expect(container.querySelector('h1')?.textContent).toContain('電話の予約を入れる')
    expect(container.querySelector('nav[aria-label="パンくず"], nav[aria-label="現在位置"]')).toBeNull()
  })

  it('戻り先は上の帯のパンくず（予約管理）へ渡す', async () => {
    await mount()
    expect(titleFn).toHaveBeenCalledWith('電話の予約を入れる')
    expect(crumbsFn).toHaveBeenCalledWith([{ label: '予約管理', href: '/booking/bookings' }])
  })
})
