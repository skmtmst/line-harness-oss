export type CustomerNotificationKpi = {
  label: string
  value: number | null
  unit: '種類' | '通'
  note: string
  href: string | null
}

export function customerNotificationKpis(input: {
  ready: boolean
  settingsCount: number
  enabledCount: number
  sentToday: number | null
  sentBreakdown: string
  failed: number | null
}): CustomerNotificationKpi[] {
  const value = (count: number | null): number | null => input.ready ? count : null
  const stoppedCount = Math.max(0, input.settingsCount - input.enabledCount)

  return [
    { label: '出しているお知らせ', value: value(input.enabledCount), unit: '種類', note: input.ready ? `全${input.settingsCount}種類のうち` : '件数を取得中', href: null },
    { label: '止めているもの', value: value(stoppedCount), unit: '種類', note: '履歴はそのまま残ります', href: null },
    { label: '今日 送った', value: value(input.sentToday), unit: '通', note: input.sentBreakdown || '種類別の件数は未取得', href: null },
    {
      label: '送れなかった',
      value: value(input.failed),
      unit: '通',
      note: '確認と別の連絡が必要',
      href: '/line-notifications?tab=failures',
    },
  ]
}

export function canOpenCustomerNotificationKpi(kpi: CustomerNotificationKpi): boolean {
  return kpi.href !== null && kpi.value !== null && kpi.value > 0
}
