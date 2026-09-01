export type CustomerNotificationKpi = {
  label: string
  value: number | null
  note: string
  href: string | null
}

export function customerNotificationKpis(input: {
  ready: boolean
  settingsCount: number
  enabledCount: number
  processed: number | null
  failed: number | null
}): CustomerNotificationKpi[] {
  const value = (count: number | null): number | null => input.ready ? count : null

  return [
    { label: '通知テンプレート', value: value(input.settingsCount), note: '顧客向けの重要通知', href: null },
    { label: '通知ON', value: value(input.enabledCount), note: '現在送信する設定', href: null },
    { label: '送信完了', value: value(input.processed), note: 'EC連携からの累計', href: null },
    {
      label: '要確認',
      value: value(input.failed),
      note: '送信に失敗した通知',
      href: '/line-notifications?tab=failures',
    },
  ]
}

export function canOpenCustomerNotificationKpi(kpi: CustomerNotificationKpi): boolean {
  return kpi.href !== null && kpi.value !== null && kpi.value > 0
}
