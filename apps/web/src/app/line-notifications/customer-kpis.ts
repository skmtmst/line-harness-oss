export type CustomerNotificationKpi = {
  label: string
  value: number | '上限なし' | null
  unit: '種類' | '通' | null
  note: string
  href: string | null
}

export type LineNotificationQuota =
  | { state: 'available'; total: number; used: number; remaining: number; asOf: string }
  | { state: 'unlimited'; total: null; used: number; remaining: null; asOf: string }
  | { state: 'unavailable'; total: null; used: null; remaining: null; asOf: null; reason: string }

export function customerNotificationKpis(input: {
  ready: boolean
  settingsCount: number
  enabledCount: number
  sentToday: number | null
  sentBreakdown: string
  failed: number | null
  quota: LineNotificationQuota | null
}): CustomerNotificationKpi[] {
  const value = (count: number | null): number | null => input.ready ? count : null
  const stoppedCount = Math.max(0, input.settingsCount - input.enabledCount)
  const quotaUnavailable = input.quota?.state === 'unavailable'
    ? input.quota.reason
    : input.quota === null ? '送信枠を取得中' : 'LINEの今月分'
  const unlimited = input.quota?.state === 'unlimited'

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
    {
      label: '今月の送信枠',
      value: unlimited ? '上限なし' : input.quota?.state === 'available' ? input.quota.total : null,
      unit: unlimited ? null : '通',
      note: quotaUnavailable,
      href: null,
    },
    {
      label: '今月使った',
      value: input.quota?.state === 'available' || input.quota?.state === 'unlimited' ? input.quota.used : null,
      unit: '通',
      note: quotaUnavailable,
      href: null,
    },
    {
      label: '今月残り',
      value: unlimited ? '上限なし' : input.quota?.state === 'available' ? input.quota.remaining : null,
      unit: unlimited ? null : '通',
      note: quotaUnavailable,
      href: null,
    },
  ]
}

export function canOpenCustomerNotificationKpi(kpi: CustomerNotificationKpi): boolean {
  return kpi.href !== null && typeof kpi.value === 'number' && kpi.value > 0
}
