// @vitest-environment happy-dom
/*
 * 担当の割り当て：編集できない人には、押せない理由を上に1回だけ出す（R5・form-action-reason）。
 * 型（CreatePage）の readOnly に寄せ、文は ReadOnlyNotice の共通文のまま。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/booking/menus/staff',
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./lib/edit-permission', () => ({ useBookingEdit: () => false }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn(), notifySaved: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    bookingApi: {
      ...actual.bookingApi,
      listMenus: async () => ({ menus: [{ id: 'm1', name: 'カット', sort_order: 1, is_active: 1 }] }),
      listStaff: async () => ({ staff: [{ id: 's1', name: '高田', display_name: '高田', is_active: 1 }] }),
      listStaffMenusBulk: async () => ({ staff: [{ staff_id: 's1', matrix: [] }] }),
    },
  }
})

import AssignMatrixV8 from './assign'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'

afterEach(() => { cleanup(); forgetStaffIdentity() })

it('編集できない人には閲覧のみの帯を出す', async () => {
  rememberStaffIdentity({ role: 'viewer' } as unknown as Parameters<typeof rememberStaffIdentity>[0])
  render(<AssignMatrixV8 />)
  expect(await screen.findByText(/閲覧のみで見ています/)).toBeTruthy()
})
