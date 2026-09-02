import type { StaffMember, SupportMark } from '@line-crm/shared'

export type TwoFactorSummary = {
  enabled: number
  total: number
}

/**
 * ダッシュボードの二段階認証は、ログインできる有効な運用者だけを数える。
 * 無効な人を分母へ入れると、設定を直せない人のせいで警告が消えなくなる。
 */
export function summarizeTwoFactor(members: StaffMember[]): TwoFactorSummary {
  const active = members.filter((member) => member.isActive)
  return {
    enabled: active.filter((member) => member.twoFactorEnabled).length,
    total: active.length,
  }
}

/** 選択中のLINEアカウントで、受信時に自動変更する対応マークがあるか。 */
export function hasInboundSupportMark(
  marks: Array<Pick<SupportMark, 'autoOnInbound'>>,
): boolean {
  return marks.some((mark) => mark.autoOnInbound)
}
