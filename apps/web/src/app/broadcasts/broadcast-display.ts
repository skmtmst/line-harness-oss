import type { ApiBroadcast, BroadcastDisplayStatus } from '@/lib/api'

/**
 * 一覧・詳細・予約完了で共通に使う、配信の見せ方の部品。
 *
 * 「10 の状態」の読み替え・追送の開き先・割合の書き方は画面ごとに
 * 書き散らすとずれるので、ここ1か所に置く。
 */

/** 10の状態が無い古い応答の読み替え（#816）。新しい口は displayStatus を返すので予備。 */
export function fallbackDisplayStatus(broadcast: ApiBroadcast): BroadcastDisplayStatus {
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
  return `${((rate <= 1 ? rate * 100 : rate)).toFixed(1)}%`
}

/** 作成の5つの手順（`draft_step` と同じ並び）。詳細・予約完了の進みの帯で使う。 */
export const CREATION_STEPS: ReadonlyArray<{ key: string; order: number; label: string }> = [
  { key: 'basic', order: 1, label: '基本設定' },
  { key: 'audience', order: 2, label: '対象者' },
  { key: 'message', order: 3, label: 'メッセージ' },
  { key: 'schedule', order: 4, label: '送信設定' },
  { key: 'confirm', order: 5, label: '確認' },
]
