import type { OperationImpactPreview } from './api'

export type EmergencyStopTarget = keyof OperationImpactPreview

function formatCount(value: number): string {
  return value.toLocaleString('ja-JP')
}

function formatScheduledAt(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).format(date)
}

/** 一覧と最終確認で同じ実測値を読み上げる。未取得は0人へ潰さない。 */
export function operationImpactText(
  target: EmergencyStopTarget,
  impact: OperationImpactPreview | null,
): string {
  if (!impact) return '影響を確認できません'
  /*
    **器が来ても、その中身まで来ているとは限らない。**
    `impact` があるかどうかだけ見ていたので、口が形の違う返事をしたとき
    `metric.friendCount` で画面ごと落ちた。落とさず「確認できません」と言う。
  */
  const metric = impact[target]
  if (!metric || typeof metric.itemCount !== 'number') return '影響を確認できません'
  const friends = metric.friendCount === null ? '—人' : `${formatCount(metric.friendCount)}人`

  switch (target) {
    case 'broadcast_dispatch': {
      const nearest = formatScheduledAt(metric.nearestScheduledAt)
      return `${formatCount(metric.itemCount)}件${nearest ? `（最も近い予約 ${nearest}）` : ''}／対象延べ${friends}`
    }
    case 'scenario_dispatch':
      return `${formatCount(metric.itemCount)}本／${friends}が進行中`
    case 'reminder_dispatch':
      return `${formatCount(metric.itemCount)}本／対象${friends}`
    case 'automation_actions':
      return `${formatCount(metric.itemCount)}本／実行待ち${formatCount(metric.pendingCount ?? 0)}件（${friends}）`
    case 'auto_reply_dispatch':
      return `${formatCount(metric.itemCount)}本／次の受信から停止`
  }
}
