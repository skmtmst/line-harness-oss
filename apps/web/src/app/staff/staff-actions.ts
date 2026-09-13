import type { StaffMember } from '@line-crm/shared'

export type StaffActionPolicy = {
  showAccountActions: boolean
  statusBlockedReason: string | null
}

/**
 * アクセス表の行とスタッフ表の人を結び付ける。
 *
 * 両表は同じ `staff_members` が元なので、本来は ID が一致する。
 * 暫定としてメール一致も見る。名前一致は同姓同名の別人へ操作が
 * 当たるので使わない。メールは権限が無いと伏せ字(`***`入り)で返る
 * ので、伏せ字同士の一致では結び付けない。
 */
export function matchStaffMember(
  members: StaffMember[],
  user: { id: string; email: string | null },
): StaffMember | null {
  const byId = members.find((member) => member.id === user.id)
  if (byId) return byId
  const email = user.email?.trim().toLowerCase() ?? ''
  if (!email.includes('@') || email.includes('*')) return null
  return members.find((member) => member.email?.trim().toLowerCase() === email) ?? null
}

/**
 * 「見せる範囲」の権限かたまりを、スタッフ更新口の役割へ寄せる。
 *
 * 更新口に `reception` の書き分けは無いので運用(`staff`)へ寄る。
 * 保存後に読み直すと「運用」と出る。
 */
export function scopeBundleToStaffRole(
  bundle: 'administrator' | 'operations' | 'reception' | 'view_only',
): 'admin' | 'staff' | 'viewer' {
  if (bundle === 'administrator') return 'admin'
  if (bundle === 'view_only') return 'viewer'
  return 'staff'
}

export function isActiveAdministrator(member: StaffMember): boolean {
  return member.isActive && (member.role === 'owner' || member.role === 'admin')
}

export function staffActionPolicy(input: {
  member: StaffMember
  currentUserId: string | null
  administrator: boolean
  activeAdministratorCount: number
}): StaffActionPolicy {
  const { member, currentUserId, administrator, activeAdministratorCount } = input
  if (!administrator) {
    return {
      showAccountActions: false,
      statusBlockedReason: null,
    }
  }

  const isSelf = member.id === currentUserId
  const removingLastAdministrator = isActiveAdministrator(member) && activeAdministratorCount <= 1
  const statusBlockedReason = member.isActive && isActiveAdministrator(member)
    ? isSelf
      ? '自分自身を無効にできません。他の管理者に依頼してください。'
      : removingLastAdministrator
        ? '管理者が一人もいなくなります。先に別の管理者を有効にしてください。'
        : null
    : null
  return { showAccountActions: true, statusBlockedReason }
}
