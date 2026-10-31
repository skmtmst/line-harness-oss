// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const identity = vi.hoisted(() => ({ role: null as string | null, keys: [] as string[] }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => identity.role }))
vi.mock('@/lib/staff-identity-state', () => ({ readStaffIdentity: () => identity.role === null ? null : { role: identity.role, permissionKeys: identity.keys } }))
vi.mock('@/lib/api', () => ({ api: {} }))
import { canManageAutomationRole, useCanManage } from './use-can-manage'
import { useAutomationManage, useAutomationRunManage } from '@/v8/automations/shell'
import { useCanManageSupportMark } from '@/components/friend-fields/support-mark-permissions'

afterEach(() => { cleanup(); identity.role = null; identity.keys = [] })

it('本人未取得は待機のまま、本人の取得・権限変更・失効で表示の可否を更新する', () => {
  const hook = renderHook(() => useCanManage())
  expect(hook.result.current).toBeNull()
  identity.role = 'owner'; hook.rerender()
  expect(hook.result.current).toBe(true)
  identity.role = 'staff'; hook.rerender()
  expect(hook.result.current).toBe(false)
  identity.keys = ['/automations']; hook.rerender()
  expect(hook.result.current).toBe(true)
  identity.role = null; hook.rerender()
  expect(hook.result.current).toBeNull()
  // 書込みを判断する純粋関数は、未取得を許可しない。
  expect(canManageAutomationRole(null)).toBe(false)
})

it('自動処理の一覧・記録と対応マークも、未取得を拒否へ変えず許可もしない', () => {
  const hook = renderHook(() => ({ manage: useAutomationManage(), runs: useAutomationRunManage(), marks: useCanManageSupportMark() }))
  expect(hook.result.current).toEqual({ manage: null, runs: null, marks: null })
  identity.role = 'staff'; hook.rerender()
  expect(hook.result.current).toEqual({ manage: false, runs: { canOperate: false, canExport: false }, marks: false })
  identity.role = 'owner'; hook.rerender()
  expect(hook.result.current).toEqual({ manage: true, runs: { canOperate: true, canExport: true }, marks: true })
})
