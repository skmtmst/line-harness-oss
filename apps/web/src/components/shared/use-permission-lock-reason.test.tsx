// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity, readStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { lockReason, PERMISSION_LOCK_REASON } from './permission-lock'
import { usePermissionLockReason } from './use-permission-lock-reason'

afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })

it('未知の表示だけ理由なし、既存helperの拒否は保ち、viewer/ownerへ購読で追従', () => {
  forgetStaffIdentity()
  const { result, rerender } = renderHook(({ allowed }) => usePermissionLockReason(allowed, 'manager'), { initialProps: { allowed: false } })
  expect(result.current).toBeUndefined()
  expect(lockReason(false, 'manager')).toBe(PERMISSION_LOCK_REASON.manager)
  verifiedStaffRole('viewer')
  expect(result.current).toBe(PERMISSION_LOCK_REASON.viewer)
  verifiedStaffRole('owner')
  rerender({ allowed: true })
  expect(result.current).toBeUndefined()
})

it.each([{ readOnly: true }, { roleBundle: 'view_only' as const }])('本人の閲覧専用%sは役割名に優先する', restriction => {
  verifiedStaffRole('owner')
  rememberStaffIdentity({ ...readStaffIdentity()!, ...restriction })
  const { result } = renderHook(() => usePermissionLockReason(false, 'owner'))
  expect(result.current).toBe(PERMISSION_LOCK_REASON.viewer)
})

it('閲覧代理の切替を購読し、unknownは代理理由も出さず、元の操作許可を広げない', () => {
  verifiedStaffRole('owner')
  const { result } = renderHook(() => usePermissionLockReason(false, 'manager'))
  expect(result.current).toBe(PERMISSION_LOCK_REASON.manager)
  const snapshot = (mode: 'read' | 'write') => ({ impersonation: { id: 'proxy', tenantId: 'tenant', mode, piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'none' as const })
  act(() => { rememberSessionSnapshot(snapshot('read')) })
  expect(result.current).toBe(PERMISSION_LOCK_REASON.impersonation)
  act(() => { rememberSessionSnapshot(snapshot('write')) })
  expect(result.current).toBe(PERMISSION_LOCK_REASON.manager)
  act(() => { forgetStaffIdentity(); rememberSessionSnapshot(snapshot('read')) })
  expect(result.current).toBeUndefined()
})
