import type { StaffMember } from '@line-crm/shared'

export type StaffActionPolicy = {
  showAccountActions: boolean
  statusBlockedReason: string | null
  deleteBlockedReason: string | null
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
      deleteBlockedReason: null,
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
  const deleteBlockedReason = isSelf
    ? '自分自身は削除できません。'
    : removingLastAdministrator
      ? '管理者が一人もいなくなります。先に別の管理者を有効にしてください。'
      : null

  return { showAccountActions: true, statusBlockedReason, deleteBlockedReason }
}

export function deletionNameMatches(expectedName: string, enteredName: string): boolean {
  return enteredName === expectedName
}

export function canExecuteStaffDeletion(input: {
  expectedName: string
  enteredName: string
  blockedReason: string | null
  deleting: boolean
}): boolean {
  return !input.deleting && !input.blockedReason && deletionNameMatches(input.expectedName, input.enteredName)
}
