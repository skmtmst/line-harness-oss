import { afterEach, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { lockMenuItems, lockReason, lockUnless, permissionLockReason, PERMISSION_LOCK_REASON } from './permission-lock'

const owner: StaffMember = {
  id: 'permission-owner', name: 'Owner', email: null, role: 'owner',
  lineLinked: false, twoFactorEnabled: true, isActive: true,
  permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active',
  createdAt: '', updatedAt: '', assignedLineAccountId: null,
  canAccessDescendantAccounts: false,
}

function impersonate(mode: 'read' | 'write') {
  rememberSessionSnapshot({
    impersonation: { id: 'permission-session', tenantId: 'permission-tenant', mode, piiRevealed: false, startedAt: '' },
    unfamiliarAt: null, stepUpMethod: 'none',
  })
}

afterEach(() => { forgetSessionSnapshot(); forgetStaffIdentity() })

it.each([true, false])('閲覧代理は元の操作許可%sより優先し、書込代理へ切り替えると元の判定へ戻る', allowed => {
  rememberStaffIdentity(owner)
  impersonate('read')
  expect(lockReason(allowed, 'owner')).toBe(PERMISSION_LOCK_REASON.impersonation)
  expect(lockUnless(allowed, 'owner')).toBe(PERMISSION_LOCK_REASON.impersonation)
  impersonate('write')
  expect(lockReason(allowed, 'owner')).toBe(allowed ? undefined : PERMISSION_LOCK_REASON.owner)
  expect(lockUnless(allowed, 'owner')).toBe(allowed ? undefined : PERMISSION_LOCK_REASON.owner)
})

it('閲覧代理でも見る項目と元の操作を保持し、変える項目だけに理由を付ける', () => {
  rememberStaffIdentity(owner)
  const view = vi.fn(), edit = vi.fn()
  const items = [
    { id: 'view', label: '詳細を見る', href: '/tags', onSelect: view },
    { id: 'edit', label: '編集する', onSelect: edit },
  ]
  impersonate('read')
  const locked = lockMenuItems(true, items, 'owner', item => item.id === 'view')
  expect(locked[0]).toBe(items[0])
  expect(locked[1]).toEqual({ ...items[1], lockedReason: PERMISSION_LOCK_REASON.impersonation })
  expect(items).toEqual([
    { id: 'view', label: '詳細を見る', href: '/tags', onSelect: view },
    { id: 'edit', label: '編集する', onSelect: edit },
  ])
  expect(view).not.toHaveBeenCalled()
  expect(edit).not.toHaveBeenCalled()
  impersonate('write')
  expect(lockMenuItems(true, items)).toBe(items)
})

it.each(['owner', 'admin', 'staff'] as const)('代理閲覧でない%sの正規許可は妨げない', role => {
  rememberStaffIdentity({ ...owner, role })
  expect(lockReason(true)).toBeUndefined()
  expect(lockUnless(true, 'manager')).toBeUndefined()
})

it.each([{ readOnly: true }, { roleBundle: 'view_only' as const }])('本人の閲覧専用%sは操作拒否時に閲覧理由を保つ', restriction => {
  rememberStaffIdentity({ ...owner, ...restriction })
  expect(lockReason(false, 'owner')).toBe(PERMISSION_LOCK_REASON.viewer)
})

it('本人が未知でも拒否側の値とメニューロックを消さない', () => {
  forgetStaffIdentity()
  expect(permissionLockReason(null, false)).toBe(PERMISSION_LOCK_REASON.feature)
  expect(permissionLockReason(undefined, false, 'manager')).toBe(PERMISSION_LOCK_REASON.manager)
  expect(lockReason(false)).toBe(PERMISSION_LOCK_REASON.feature)
  expect(lockMenuItems(false, [{ id: 'edit', label: '編集する' }])[0].lockedReason).toBe(PERMISSION_LOCK_REASON.feature)
})
