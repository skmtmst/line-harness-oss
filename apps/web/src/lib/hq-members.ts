import type { StaffMember } from '@line-crm/shared'
import { parseJstDateTime } from './hq-banners'
import { formatRelative } from '@/lib/format'

/**
 * 統括のメンバー管理（★V6 36-5）の小さな計算。通信は持たない。
 */

export type MemberStatus = 'active' | 'invited' | 'expired' | 'inactive'

export const ROLE_LABELS: Record<StaffMember['role'], string> = {
  owner: '統括',
  admin: '管理者',
  staff: '担当者',
  viewer: '閲覧のみ',
}

export const STATUS_LABELS: Record<MemberStatus, string> = {
  active: '有効',
  invited: '招待中',
  expired: '期限切れ',
  inactive: '無効',
}

/** 表の「状態」。有効／招待中／期限切れ／無効の4つ。 */
export function memberStatus(member: Pick<StaffMember, 'isActive' | 'inviteStatus'>): MemberStatus {
  if (member.isActive) return 'active'
  if (member.inviteStatus === 'pending_email' || member.inviteStatus === 'pending_line') return 'invited'
  if (member.inviteStatus === 'expired') return 'expired'
  return 'inactive'
}

/** 招待メールを送り直せるのは、まだメールを確認していない人だけ（API と同じ）。 */
export function canResendInvite(member: Pick<StaffMember, 'isActive' | 'inviteStatus' | 'email'>): boolean {
  return !member.isActive && member.inviteStatus === 'pending_email' && Boolean(member.email)
}

/** 「今日 21:40」「昨日 18:02」「9/10」「—」 */
export function lastLoginLabel(iso: string | undefined, now = new Date()): string {
  if (!iso) return '—'
  const date = parseJstDateTime(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return formatRelative(date, now)
}

/** 担当範囲の文。「全アカウント」かアカウント名の列挙。 */
export function scopeLabel(member: Pick<StaffMember, 'accountScope' | 'scopedLineAccountIds'>, accountNames: Map<string, string>): string {
  if (member.accountScope !== 'accounts') return '全アカウント'
  const names = (member.scopedLineAccountIds ?? []).map((id) => accountNames.get(id) ?? '不明なアカウント')
  return names.length > 0 ? names.join('、') : 'アカウントなし'
}

/** 数値カード帯の4つ。 */
export function memberKpis(members: StaffMember[]): {
  total: number
  active: number
  invited: number
  viewers: number
  scopedAccounts: number
  allScope: number
} {
  const scoped = new Set<string>()
  let allScope = 0
  for (const m of members) {
    if (m.accountScope === 'accounts') (m.scopedLineAccountIds ?? []).forEach((id) => scoped.add(id))
    else allScope += 1
  }
  return {
    total: members.length,
    active: members.filter((m) => m.isActive).length,
    invited: members.filter((m) => memberStatus(m) === 'invited').length,
    viewers: members.filter((m) => m.role === 'viewer').length,
    scopedAccounts: scoped.size,
    allScope,
  }
}

/** 表の並び。自分を先頭、次に有効、招待中、そのあと名前順。 */
export function sortMembers(members: StaffMember[], meId: string | null): StaffMember[] {
  const rank = (m: StaffMember) => (m.id === meId ? 0 : memberStatus(m) === 'active' ? 1 : memberStatus(m) === 'invited' ? 2 : 3)
  return [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ja'))
}
