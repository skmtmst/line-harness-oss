/*
 * 友だち追加時の配信の実行結果で使う、状態の言葉・CSV の1マス・時刻の書き方。
 * 写し元：`app/friend-add-settings/runs/run-status.ts`・`csv.ts`（src/v8 からは import できないので写した）。
 * 一覧と詳細で同じ判定を使う（送達不明を「配信なし」と読ませない）。
 */
import type { FriendAddEventRoutingStatus } from '@line-crm/shared'
import type { StatusBadgeTone } from '@/components/shared/status-badge'
import { formatDateTime } from '@/lib/format'

const ROUTING_LABELS: Record<FriendAddEventRoutingStatus, { label: string; tone: StatusBadgeTone }> = {
  pending: { label: 'テスト待ち', tone: 'warning' },
  completed: { label: '成功', tone: 'success' },
  failed: { label: '失敗', tone: 'danger' },
  suppressed: { label: '配信なし', tone: 'neutral' },
  partial_failed: { label: '再送待ち', tone: 'warning' },
}

const ROUTING_ACTIONS: Record<FriendAddEventRoutingStatus, string> = {
  pending: '配信・処理を確認中',
  completed: '初回案内を実行',
  failed: '配信・処理に失敗',
  suppressed: '配信・処理なし',
  partial_failed: '送れず再送待ち',
}

/** 送達不明：届いたか分からない。自動では送り直さない（送り直すと二重に届く）。 */
export const DELIVERY_UNKNOWN_CODE = 'delivery_unknown'

export function routingLabel(status: FriendAddEventRoutingStatus, errorCode: string | null): { label: string; tone: StatusBadgeTone } {
  if (errorCode === DELIVERY_UNKNOWN_CODE) return { label: '送達不明', tone: 'danger' }
  return ROUTING_LABELS[status] ?? { label: '不明', tone: 'neutral' }
}

export function routingAction(status: FriendAddEventRoutingStatus, errorCode: string | null): string {
  if (errorCode === DELIVERY_UNKNOWN_CODE) return '送達不明・要確認（自動では送り直しません）'
  return ROUTING_ACTIONS[status] ?? '状態を確認中'
}

/** DB には JST の時刻をオフセットなしで保存した古い行がある。UTC へ読み替えず、そのまま JST として出す。 */
export function formatJstDateTime(value: string | null): string {
  if (!value) return '—'
  const bare = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (bare && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return `${bare[1]}/${bare[2]}/${bare[3]} ${bare[4]}:${bare[5]}`
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return formatDateTime(parsed)
}

/** 表の「日時」は時:分だけ（全文は title）。 */
export function jstTime(value: string | null): string {
  const full = formatJstDateTime(value)
  const match = full.match(/(\d{1,2}:\d{2})$/)
  return match ? match[1] : full
}

/** CSV の1マス。先頭が `= + - @` タブなら `'` を付けて式として動かないようにする。 */
export function csvCell(value: string): string {
  const escaped = value.replaceAll('"', '""')
  const guarded = /^[=+\-@\t]/.test(escaped) ? `'${escaped}` : escaped
  return `"${guarded}"`
}

/** 受信から処理までの秒（かかった時間）。 */
export function elapsedText(receivedAt: string, processedAt: string | null): string {
  if (!processedAt) return '—'
  const ms = new Date(processedAt).getTime() - new Date(receivedAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return '—'
  return `${(ms / 1000).toFixed(1)}秒`
}
