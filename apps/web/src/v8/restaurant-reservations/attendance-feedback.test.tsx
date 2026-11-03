// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { customerHistory: vi.fn().mockResolvedValue({ data: { visitCount: 0, visits: [] } }) } }))
import ReservationDetailDialog from './detail-dialog'
import { ApiError } from '@/lib/api'
import { reservation, snapshotOf } from '../restaurant/booking-kit/test-data'
import type { RestaurantReservation } from '@/lib/restaurant-test-api'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'

afterEach(() => { cleanup(); verifiedStaffRole(null); vi.clearAllMocks() })
it('来店の失敗理由を予約の詳細の中に表示する', async () => {
  verifiedStaffRole('owner')
  const data = snapshotOf()
  const row = reservation('r1', { customer_name: '架空のお客さま', arrived_at: null, departed_at: null }) as RestaurantReservation
  const attendance = vi.fn().mockResolvedValue({ error: new ApiError(409, '最新の予約を確認してください。', 'version_conflict') })
  render(<ReservationDetailDialog reservation={row} accountId="account-1" tables={data.tables} courses={data.menuItems} busy={false} canWrite onClose={vi.fn()} onCancel={vi.fn()} onRestore={vi.fn()} onEdit={vi.fn()} onAttendance={attendance} />)
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: '来店にする', exact: true }))
  expect(attendance).toHaveBeenCalledOnce()
  expect((await within(dialog).findByRole('alert')).textContent).toContain('最新の予約を確認してください。')
})

it('詳細を切り替えた後に前の予約の失敗を表示しない', async () => {
  verifiedStaffRole('owner')
  const data = snapshotOf()
  const row = reservation('r1', { customer_name: '架空のお客さま', arrived_at: null, departed_at: null }) as RestaurantReservation
  let finish!: (value: { error: Error }) => void
  const attendance = vi.fn(() => new Promise<{ error: Error }>((resolve) => { finish = resolve }))
  const props = { reservation: row, accountId: 'account-1', tables: data.tables, courses: data.menuItems, busy: false, canWrite: true, onClose: vi.fn(), onCancel: vi.fn(), onRestore: vi.fn(), onEdit: vi.fn(), onAttendance: attendance }
  const view = render(<ReservationDetailDialog {...props} />)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '来店にする', exact: true }))
  view.rerender(<ReservationDetailDialog {...props} reservation={{ ...row, id: 'r2', customer_name: '別の架空のお客さま' }} />)
  finish({ error: new ApiError(409, '前の予約の失敗です。', 'version_conflict') })
  await Promise.resolve()
  expect(screen.queryByText('前の予約の失敗です。')).toBeNull()
})
