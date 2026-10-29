// @vitest-environment happy-dom
/*
 * 担当の割り当て：編集できない人には、押せない理由を上に1回だけ出す（R5・form-action-reason）。
 * 他画面（シナリオ・タグ・ウェビナー）と同じ題下の自前の帯。文は ReadOnlyNotice の共通文のまま。
 * 役割が読めるまで帯は出さない（空の div で段間を空けない）。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const mocks = vi.hoisted(() => ({ canEdit: false }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/booking/menus/staff',
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./lib/edit-permission', () => ({ useBookingEdit: () => mocks.canEdit }))
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
import styles from './assign.module.css'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'

type Identity = Parameters<typeof rememberStaffIdentity>[0]
const asIdentity = (role: string) => ({ role }) as unknown as Identity

beforeEach(() => { mocks.canEdit = false })
afterEach(() => { cleanup(); forgetStaffIdentity() })

it('編集できない人には閲覧のみの帯を出す', async () => {
  rememberStaffIdentity(asIdentity('viewer'))
  render(<AssignMatrixV8 />)
  expect(await screen.findByText(/閲覧のみで見ています/)).toBeTruthy()
})

it('編集できる人には帯を出さない', async () => {
  mocks.canEdit = true
  rememberStaffIdentity(asIdentity('owner'))
  render(<AssignMatrixV8 />)
  await screen.findByLabelText(/カット を .* が受ける/)
  expect(screen.queryByText(/閲覧のみで見ています/)).toBeNull()
})

it('役割が読めるまで帯を出さない', async () => {
  const { container } = render(<AssignMatrixV8 />)
  await screen.findByLabelText(/カット を .* が受ける/)
  expect(screen.queryByText(/閲覧のみで見ています/)).toBeNull()
  // 空の div も残さない（段間を空けない）。
  expect(container.querySelector(`.${styles.viewerBand}`)).toBeNull()
})
