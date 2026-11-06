// @vitest-environment happy-dom
/*
 * 73: 作る画面のパンくずは上の帯だけ。板の中に2つ目のパンくず（下線の文字・区切り「/」）を置かない。
 * 担当スタッフ：題は共通の PageHeading、戻り先は上の帯のパンくず（予約設定）へ。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const crumbsFn = vi.hoisted(() => vi.fn())
const titleFn = vi.hoisted(() => vi.fn())

const fixture = vi.hoisted(() => ({
  listStaff: null as null | (() => Promise<unknown>),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [] }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: (...args: unknown[]) => titleFn(...args),
  usePageCrumbs: (...args: unknown[]) => crumbsFn(...args),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await (importOriginal as () => Promise<typeof import('@/lib/api')>)()
  return {
    ...actual,
    bookingApi: {
      listStaff: (...args: unknown[]) => fixture.listStaff!(...(args as [])),
      createStaff: vi.fn(async () => ({ ok: true })),
      updateStaff: vi.fn(async () => ({ ok: true })),
      deleteStaff: vi.fn(async () => ({ ok: true })),
    },
  }
})

import BookingStaffPage from './page'

const ROW = {
  id: 'staff-a', name: 'yamada', display_name: '山田', role: 'スタイリスト',
  profile_image_url: '', bio: '', sort_order: 0,
  is_designation_optional: 0, is_active: 1,
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  fixture.listStaff = async () => ({ staff: [ROW] })
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

describe('73 担当スタッフ：板の中にパンくずを置かない', () => {
  test('題は共通の見出しで、板の中に2つ目のパンくずが無い', async () => {
    const { container } = render(<BookingStaffPage />)
    expect(await screen.findByText('山田')).toBeTruthy()
    expect(container.querySelector('h1')?.textContent).toContain('担当スタッフ')
    expect(container.querySelector('nav[aria-label="パンくず"], nav[aria-label="現在位置"]')).toBeNull()
  })

  test('戻り先は上の帯のパンくず（予約設定）へ渡す', async () => {
    render(<BookingStaffPage />)
    expect(await screen.findByText('山田')).toBeTruthy()
    expect(titleFn).toHaveBeenCalledWith('担当スタッフ')
    expect(crumbsFn).toHaveBeenCalledWith([{ label: '予約設定', href: '/booking/menus' }])
  })
})
