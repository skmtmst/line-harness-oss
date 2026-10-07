import { describe, expect, it } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { canResendInvite, lastLoginLabel, lastLoginShort, memberKpis, memberStatus, scopeLabel, sortMembers, sortMembersByRole } from './hq-members'

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

  it('最終ログインは「20分前」「昨日 18:02」「2日前」「—」', () => {
    const now = new Date('2026-09-12T13:00:00Z') // 日本時間 9/12 22:00
    expect(lastLoginLabel('2026-09-12T21:40:00.000', now)).toBe('20分前')
    expect(lastLoginLabel('2026-09-11T18:02:00.000', now)).toBe('昨日 18:02')
    expect(lastLoginLabel('2026-09-10T09:00:00.000', now)).toBe('2日前')
    expect(lastLoginLabel(undefined, now)).toBe('—')
  })

  it('担当範囲と数値カード', () => {
    const names = new Map([['a1', '然-NEN- TEST']])
    const scoped: StaffMember = { ...base, id: 's2', role: 'viewer', accountScope: 'accounts', scopedLineAccountIds: ['a1'] }
    const invited: StaffMember = { ...base, id: 's3', role: 'staff', isActive: false, inviteStatus: 'pending_email' }
    expect(scopeLabel(base, names)).toBe('全アカウント')
    expect(scopeLabel(scoped, names)).toBe('然-NEN- TEST')
    expect(memberKpis([base, scoped, invited])).toEqual({ total: 3, active: 2, invited: 1, viewers: 1, scopedAccounts: 1, allScope: 2 })
    expect(sortMembers([invited, scoped, base], 's2').map((m) => m.id)).toEqual(['s2', 's1', 's3'])
  })

  it('★V8 の最終ログインは「9/30 10:12」。今年でなければ年を付ける', () => {
    const now = new Date('2026-10-07T03:00:00Z')
    expect(lastLoginShort('2026-09-30T10:12:00+09:00', now)).toBe('9/30 10:12')
    expect(lastLoginShort('2026-09-28T09:02:00.000', now)).toBe('9/28 09:02')
    expect(lastLoginShort('2025-08-31T12:00:00+09:00', now)).toBe('2025/8/31 12:00')
    expect(lastLoginShort(undefined, now)).toBe('—')
    expect(lastLoginShort('壊れた値', now)).toBe('—')
  })

  it('★V8 の並びは状態→役割→名前（絵 r4ARpV の順）', () => {
    const owner: StaffMember = { ...base, id: 'o', name: '高田 誠', role: 'owner' }
    const admin: StaffMember = { ...base, id: 'a', name: '中川 由美', role: 'admin' }
    const viewer: StaffMember = { ...base, id: 'v', name: '佐野 直人', role: 'viewer' }
    const invited: StaffMember = { ...base, id: 'i', name: '外部デザイン', role: 'viewer', isActive: false, inviteStatus: 'pending_line' }
    const stopped: StaffMember = { ...base, id: 's', name: '森 涼太', role: 'viewer', isActive: false, inviteStatus: 'disabled' as StaffMember['inviteStatus'] }
    expect(sortMembersByRole([stopped, viewer, invited, admin, owner]).map((m) => m.id)).toEqual(['o', 'a', 'v', 'i', 's'])
  })
})
