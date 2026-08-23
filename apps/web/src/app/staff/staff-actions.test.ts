import { describe, expect, it } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { canExecuteStaffDeletion, staffActionPolicy } from './staff-actions'

function member(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 'user-1',
    name: '山田 太郎',
    email: null,
    role: 'staff',
    lineLinked: false,
    twoFactorEnabled: false,
    isActive: true,
    permissionKeys: [],
    notificationPreferences: {},
    inviteStatus: 'active',
    createdAt: '2026-08-23T10:00:00.000Z',
    updatedAt: '2026-08-23T10:00:00.000Z',
    assignedLineAccountId: null,
    canAccessDescendantAccounts: false,
    ...overrides,
  }
}

describe('ログインユーザーの危険操作', () => {
  it('自分自身の削除を押せない理由を返す', () => {
    const policy = staffActionPolicy({
      member: member({ id: 'me', role: 'admin' }),
      currentUserId: 'me',
      administrator: true,
      activeAdministratorCount: 2,
    })
    expect(policy.deleteBlockedReason).toContain('自分自身')
  })

  it('最後の管理者は無効化も削除も押せない', () => {
    const policy = staffActionPolicy({
      member: member({ role: 'admin' }),
      currentUserId: 'another-admin',
      administrator: true,
      activeAdministratorCount: 1,
    })
    expect(policy.statusBlockedReason).toContain('管理者が一人もいなくなります')
    expect(policy.deleteBlockedReason).toContain('管理者が一人もいなくなります')
  })

  it('閲覧のみの利用者には無効化・削除操作を出さない', () => {
    const policy = staffActionPolicy({
      member: member(),
      currentUserId: 'viewer',
      administrator: false,
      activeAdministratorCount: 1,
    })
    expect(policy.showAccountActions).toBe(false)
  })

  it('削除確認の名前が完全一致しない限り実行できない', () => {
    expect(canExecuteStaffDeletion({ expectedName: '山田 太郎', enteredName: '山田太郎', blockedReason: null, deleting: false })).toBe(false)
    expect(canExecuteStaffDeletion({ expectedName: '山田 太郎', enteredName: '山田 太郎 ', blockedReason: null, deleting: false })).toBe(false)
    expect(canExecuteStaffDeletion({ expectedName: '山田 太郎', enteredName: '山田 太郎', blockedReason: null, deleting: false })).toBe(true)
  })
})
