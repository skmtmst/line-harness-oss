import type { FriendAddEventRoutingStatus } from '@line-crm/shared'
import type { StatusBadgeTone } from '@/components/shared/status-badge'

export const ROUTING_LABELS: Record<FriendAddEventRoutingStatus, { label: string; tone: StatusBadgeTone }> = {
  pending: { label: 'テスト待ち', tone: 'info' },
  completed: { label: '成功', tone: 'success' },
  failed: { label: 'エラー', tone: 'danger' },
  suppressed: { label: '配信なし', tone: 'neutral' },
  partial_failed: { label: '再送待ち', tone: 'warning' },
}

export const ROUTING_ACTIONS: Record<FriendAddEventRoutingStatus, string> = {
  pending: '配信・処理を確認中',
  completed: '初回案内を実行',
  failed: '配信・処理に失敗',
  suppressed: '配信・処理なし',
  partial_failed: '送れず再送待ち',
}

/** 将来の状態が来ても描画を落とさない受け皿。 */
export const UNKNOWN_ROUTING_LABEL = { label: '不明', tone: 'neutral' } as const
export const UNKNOWN_ROUTING_ACTION = '状態を確認中'

/*
 * 送達不明。送信は試したが、届いたかどうか分からない実行。
 * **自動では送り直さない**（送り直すと二重に届く）。「再送待ち」と同じ
 * 見た目にすると、放っておけばそのうち届くと読めてしまう。分けて出す。
 * 一覧と詳細で同じ判定を使う（R267）——片方だけ「配信なし」に変わると、
 * 届いたか分からない記録を「送らなかった」と誤認する。
 */
export const DELIVERY_UNKNOWN_CODE = 'delivery_unknown'
export const DELIVERY_UNKNOWN_LABEL = { label: '送達不明', tone: 'danger' } as const
export const DELIVERY_UNKNOWN_ACTION = '送達不明・要確認（自動では送り直しません）'

export function routingLabel(
  status: FriendAddEventRoutingStatus,
  errorCode: string | null,
): { label: string; tone: StatusBadgeTone } {
  if (errorCode === DELIVERY_UNKNOWN_CODE) return DELIVERY_UNKNOWN_LABEL
  return ROUTING_LABELS[status] ?? UNKNOWN_ROUTING_LABEL
}

export function routingAction(status: FriendAddEventRoutingStatus, errorCode: string | null): string {
  if (errorCode === DELIVERY_UNKNOWN_CODE) return DELIVERY_UNKNOWN_ACTION
  return ROUTING_ACTIONS[status] ?? UNKNOWN_ROUTING_ACTION
}

/** DBにはJSTの時刻をオフセットなしで保存した古い行がある。UTCへ読み替えず、そのままJSTとして表示する。 */
export function formatJstDateTime(value: string | null): string {
  if (!value) return '—'
  const bare = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (bare && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return `${bare[1]}/${bare[2]}/${bare[3]} ${bare[4]}:${bare[5]}`
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}
