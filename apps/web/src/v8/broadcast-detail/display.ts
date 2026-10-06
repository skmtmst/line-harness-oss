import type { ApiBroadcast, BroadcastDisplayStatus } from '@/lib/api'
import { formatDateTime } from '@/lib/format'

/*
 * ★V8 一斉配信の詳細・予約したあとで使う、見せ方の小さな関数。
 * 今の画面（app/broadcasts/broadcast-display.ts・detail/broadcast-insight-display.ts）
 * から写した。src/v8 は古い画面ファイルを import できないので写しで持つ。
 */

/** 10の状態が無い古い応答の読み替え（#816）。新しい口は displayStatus を返すので予備。 */
function fallbackDisplayStatus(broadcast: ApiBroadcast): BroadcastDisplayStatus {
  if (broadcast.approvalStatus === 'pending') return 'pending_approval'
  if (broadcast.approvalStatus === 'expired') return 'expired'
  if (broadcast.stopped) return 'stopped'
  if (broadcast.status === 'sending') return 'sending'
  if (broadcast.status === 'scheduled') return 'scheduled'
  if (broadcast.status === 'sent') return 'sent'
  return 'draft'
}

/** 表示に使う状態と言葉。口の displayStatus が無いときは読み替える。 */
export function displayStatusOf(broadcast: ApiBroadcast): { status: BroadcastDisplayStatus; label: string } {
  const status = broadcast.displayStatus ?? fallbackDisplayStatus(broadcast)
  return { status, label: broadcast.displayStatusLabel ?? status }
}

/** 「この配信のリンクを押していない人」を宛先にした作成画面のURL。宛先は condition 引継ぎ。 */
export function chaseHref(broadcastId: string): string {
  const condition = JSON.stringify({
    operator: 'AND',
    rules: [{ type: 'broadcast_link_clicked', value: { broadcastId, clicked: false } }],
  })
  return `/broadcasts/new?duplicateFrom=${encodeURIComponent(broadcastId)}&condition=${encodeURIComponent(condition)}`
}

/** 割合の書き方（0〜1 と 0〜100 の両方の形で来る値に対応）。 */
export function rateText(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${(rate <= 1 ? rate * 100 : rate).toFixed(1)}%`
}

/**
 * 作成の5つの手順（`draft_step` と同じ並び）。言葉は ★V8 の絵
 * （詳細の下書き `cgiGB`・予約したあと `cdZBf`）どおり。
 * key は作成画面の `?step=` と同じ。
 */
export const CREATION_STEPS: ReadonlyArray<{ key: string; order: number; label: string }> = [
  { key: 'basic', order: 1, label: '基本設定' },
  { key: 'audience', order: 2, label: '対象者' },
  { key: 'message', order: 3, label: 'メッセージ' },
  { key: 'schedule', order: 4, label: '送信設定' },
  { key: 'confirm', order: 5, label: '確認' },
]

/** 「8月24日（月）10:00」。無い・読めないときは「—」。 */
export function formatBroadcastDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}

const SHORT = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** スマホの札の短い日時「8/24（月）10:00」（絵 `pNiUk`・`cdZBf`）。 */
export function formatShortDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const part = (type: string) => SHORT.formatToParts(date).find((p) => p.type === type)?.value ?? ''
  return `${part('month')}/${part('day')}（${part('weekday')}）${part('hour')}:${part('minute')}`
}

const MONTH_DAY = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })

/** 「8月19日」（承認した日など、曜日も時刻も要らない日付）。 */
export function formatMonthDay(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const part = (type: string) => MONTH_DAY.formatToParts(date).find((p) => p.type === type)?.value ?? ''
  return `${part('month')}月${part('day')}日`
}
