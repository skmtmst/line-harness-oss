import { describe, expect, it } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { canResendInvite, lastLoginLabel, memberKpis, memberStatus, scopeLabel, sortMembers } from './hq-members'

const base: StaffMember = {
  id: 's1', name: '山田 太郎', email: 'm@example.com', role: 'admin', lineLinked: true, twoFactorEnabled: false,
  isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active', createdAt: '', updatedAt: '',
  assignedLineAccountId: null, canAccessDescendantAccounts: true, accountScope: 'all', scopedLineAccountIds: [],
}

describe('メンバー管理の計算', () => {
  it('状態は有効／招待中／期限切れ／無効の4つ', () => {
    expect(memberStatus(base)).toBe('active')
    expect(memberStatus({ isActive: false, inviteStatus: 'pending_email' })).toBe('invited')
    expect(memberStatus({ isActive: false, inviteStatus: 'pending_line' })).toBe('invited')
    expect(memberStatus({ isActive: false, inviteStatus: 'expired' })).toBe('expired')
    expect(memberStatus({ isActive: false, inviteStatus: 'active' })).toBe('inactive')
  })

  it('再送できるのはメール未確認の人だけ', () => {
    expect(canResendInvite({ isActive: false, inviteStatus: 'pending_email', email: 'a@b.c' })).toBe(true)
    expect(canResendInvite({ isActive: false, inviteStatus: 'pending_line', email: 'a@b.c' })).toBe(false)
    expect(canResendInvite({ isActive: true, inviteStatus: 'active', email: 'a@b.c' })).toBe(false)
  })

  it('最終ログインは「今日 21:40」「昨日 18:02」「9/10」「—」', () => {
    const now = new Date('2026-09-12T13:00:00Z') // 日本時間 9/12 22:00
    expect(lastLoginLabel('2026-09-12T21:40:00.000', now)).toBe('今日 21:40')
    expect(lastLoginLabel('2026-09-11T18:02:00.000', now)).toBe('昨日 18:02')
    expect(lastLoginLabel('2026-09-10T09:00:00.000', now)).toBe('9/10')
    expect(lastLoginLabel(undefined, now)).toBe('—')
  })

  it('担当範囲と数値カード', () => {
    const names = new Map([['a1', '然-NEN- TEST']])
    const scoped: StaffMember = { ...base, id: 's2', role: 'viewer', accountScope: 'accounts', scopedLineAccountIds: ['a1'] }
    const invited: StaffMember = { ...base, id: 's3', role: 'staff', isActive: false, inviteStatus: 'pending_email' }
    expect(scopeLabel(base, names)).toBe('全店舗')
    expect(scopeLabel(scoped, names)).toBe('然-NEN- TEST')
    expect(memberKpis([base, scoped, invited])).toEqual({ total: 3, active: 2, invited: 1, viewers: 1, scopedAccounts: 1, allScope: 2 })
    expect(sortMembers([invited, scoped, base], 's2').map((m) => m.id)).toEqual(['s2', 's1', 's3'])
  })
})
