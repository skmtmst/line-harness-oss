// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const permission = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/staff-capability', () => ({ canEditFeature: () => permission.value }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, bookingApi: { ...actual.bookingApi, listStaff: async () => ({ staff: [{ id: 's', name: '佐野', display_name: '佐野', is_active: 1 }] }) } }
})
import BookingStaffPage from './page'
afterEach(cleanup)
it('PKG-CAND-booking-staff-readonly: 閲覧のみは作成を隠し、スタッフとシフトは読める', async () => {
  permission.value = false
  render(<BookingStaffPage />)
  await screen.findByText('佐野')
  expect(screen.queryByRole('button', { name: '＋ スタッフを作る' })).toBeNull()
  expect(screen.queryByRole('button', { name: '編集' })).toBeNull()
  expect(screen.getByRole('link', { name: 'シフト' })).toBeTruthy()
  expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()
})
it('PKG-CAND-booking-staff-readonly: 設定権限がある人には作成を残す', async () => {
  permission.value = true
  render(<BookingStaffPage />)
  await screen.findByText('佐野')
  expect((screen.getByRole('button', { name: '＋ スタッフを作る' }) as HTMLButtonElement).disabled).toBe(false)
})
