// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
const me = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { staff: { me } } }))
import { effectiveStaffRole, loadStaffIdentity, useStaffRole, canManageRole, isOwnerRole } from './staff-role'
import { usePermissionAccess, useFeatureAccess } from './use-feature-access'
import { forgetStaffIdentity, readStaffIdentity } from './staff-identity-state'
import { canOperateBookings } from '@/app/booking/lib/booking-permissions'
import { canEditManualLinks } from './manual-link-access'

beforeEach(() => { forgetStaffIdentity(); me.mockReset() })
afterEach(() => { cleanup(); forgetStaffIdentity() })
function Controls() {
  const role = useStaffRole()
  const booking = usePermissionAccess('/booking/bookings')
  const media = useFeatureAccess('contents')
  return <>{canManageRole(role) && <button>編集する</button>}{isOwnerRole(role) && <button>実行する</button>}{booking && <button>予約を入れる</button>}{media && <button>メディアを変える</button>}</>
}
const identity = (extra: Partial<StaffMember>): StaffMember => ({ id: 'self', role: 'admin', permissionKeys: ['/booking/bookings', '/contents', 'contents.media.edit'], ...extra } as StaffMember)
it.each([
  { role: 'admin', readOnly: true }, { role: 'owner', roleBundle: 'view_only' }, { role: 'viewer' },
] as Partial<StaffMember>[])('共通の非同期読取と全フックで閲覧のみの操作が出ない: %j', async (extra) => {
  const staff = identity(extra)
  me.mockResolvedValue({ success: true, data: staff })
  const response = await loadStaffIdentity()
  expect(response.success && response.data.role).toBe('viewer')
  render(<Controls />)
  await act(async () => {})
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(canOperateBookings(staff)).toBe(false)
  expect(canEditManualLinks({ ...staff, id: 'env-owner', permissionKeys: ['manual.link.edit'] })).toBe(false)
})
it('未確認では隠し、本人APIの返事を全フックと非同期処理で共有してから許可する', async () => {
  let resolve!: (value: unknown) => void
  me.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<Controls />)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  const pending = loadStaffIdentity()
  await act(async () => { await Promise.resolve(); resolve({ success: true, data: identity({ role: 'owner' }) }); await pending })
  expect(me).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.getByRole('button', { name: '予約を入れる' })).toBeTruthy())
  expect(screen.getByRole('button', { name: '実行する' })).toBeTruthy()
})
it('取得失敗では許可せず、明示的な読み直しで回復できる', async () => {
  me.mockRejectedValueOnce(new Error('offline'))
  render(<Controls />)
  await act(async () => { await Promise.resolve() })
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  me.mockResolvedValue({ success: true, data: identity({}) })
  await act(async () => { await loadStaffIdentity() })
  expect(screen.getByRole('button', { name: '編集する' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '実行する' })).toBeNull()
})
it('別セッションの返事が遅れて来ても古い権限を返さない', async () => {
  let resolve!: (value: unknown) => void
  me.mockImplementation(() => new Promise(r => { resolve = r }))
  const pending = loadStaffIdentity()
  const rejected = expect(pending).rejects.toThrow('Staff session changed')
  await Promise.resolve()
  forgetStaffIdentity()
  resolve({ success: true, data: identity({ role: 'owner' }) })
  await rejected
  expect(effectiveStaffRole(null)).toBeNull()
  expect(readStaffIdentity()).toBeNull()
})

it('名前やIDだけの単発読取を次のセッションの権限キャッシュに残さない', async () => {
  me.mockResolvedValue({ success: true, data: identity({ role: 'owner' }) })
  const response = await loadStaffIdentity()
  expect(response.success && response.data.id).toBe('self')
  expect(readStaffIdentity()).toBeNull()
})
