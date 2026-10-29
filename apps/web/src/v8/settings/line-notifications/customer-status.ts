import type { EcNotificationSetting } from '@/lib/api'

/** 前後の文は任意。必須の見出しが空のときだけ文面の設定が必要。 */
export function customerNotificationIncomplete(setting: Pick<EcNotificationSetting, 'title'>): boolean {
  return !setting.title?.trim()
}

export function customerNotificationStatus(setting: Pick<EcNotificationSetting, 'title' | 'isEnabled'>): { label: string; tone: 'good' | 'muted'; warning: string | null } {
  return {
    label: setting.isEnabled ? '出している' : '停止中',
    tone: setting.isEnabled ? 'good' : 'muted',
    warning: customerNotificationIncomplete(setting) ? '要確認：文面が未設定' : null,
  }
}
