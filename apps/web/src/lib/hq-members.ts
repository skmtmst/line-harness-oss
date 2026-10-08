import type { StaffMember } from '@line-crm/shared'
import { parseJstDateTime } from './hq-banners'
import { formatRelative } from '@/lib/format'

/**
 * 統括のメンバー管理（★V6 36-5）の小さな計算。通信は持たない。
 */

export type MemberStatus = 'active' | 'invited' | 'expired' | 'inactive'

export const ROLE_LABELS: Record<StaffMember['role'], string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
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

/**
 * ★V8 の表の「最終ログイン」（絵 `r4ARpV`：「9/30 10:12」）。日本時間の 月/日 時:分。
 * 今年でないときは年を前に付ける（「2025/8/31 12:00」）。取れないときは「—」。
 */
export function lastLoginShort(iso: string | undefined, now = new Date()): string {
  if (!iso) return '—'
  const date = parseJstDateTime(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const pick = (d: Date) => Object.fromEntries(fmt.formatToParts(d).map((part) => [part.type, part.value]))
  const at = pick(date)
  const year = at.year === pick(now).year ? '' : `${at.year}/`
  return `${year}${Number(at.month)}/${Number(at.day)} ${at.hour}:${at.minute}`
}

const ROLE_ORDER: Record<StaffMember['role'], number> = { owner: 0, admin: 1, staff: 2, viewer: 3 }
const STATUS_ORDER: Record<MemberStatus, number> = { active: 0, invited: 1, expired: 2, inactive: 3 }

/**
 * ★V8 の表の並び（絵 `r4ARpV`：高田（オーナー）→中川（管理者）→佐野（閲覧のみ）→外部デザイン（招待中）→森（停止中））。
 * 状態（有効→招待中→期限切れ→停止中）、同じ状態の中は役割（オーナー→管理者→担当者→閲覧のみ）、そのあと名前順。
 * v7 の表は `sortMembers`（自分を先頭）のまま。
 */
export function sortMembersByRole(members: StaffMember[]): StaffMember[] {
  return [...members].sort((a, b) =>
    STATUS_ORDER[memberStatus(a)] - STATUS_ORDER[memberStatus(b)]
    || (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    || a.name.localeCompare(b.name, 'ja'))
}
