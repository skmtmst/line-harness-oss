import type { MileageAdminHistoryItem, MileageHistoryItem } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'

const ENTRY_TYPE_LABELS: Record<MileageHistoryItem['entryType'], string> = {
  grant: '付与',
  reversal: '取消',
  spend: '使用',
  expiration: '失効',
  adjustment: '手動調整',
}

const STATUS_LABELS: Record<MileageHistoryItem['status'], string> = {
  pending: '確定待ち',
  available: '利用可能',
  void: '取消済み',
}

const SOURCE_LABELS: Record<string, string> = {
  line: 'LINE',
  line_relationship: '友だち登録・継続',
  tracked_link: '計測リンク',
  form: '回答フォーム',
  booking: '予約',
  webinar: 'ウェビナー',
  instagram: 'Instagram',
  stripe: '購入',
  tag: 'タグ',
  tag_referral: '紹介',
  affiliate: '紹介成果',
  affiliate_conversion: '紹介成果',
  friend_add_routing: '友だち追加',
  rich_menu: 'リッチメニュー',
  event_booking: 'イベント予約',
  manual: '手動調整',
  admin_adjustment: '手動調整',
}

export function mileageEntryTypeLabel(value: MileageHistoryItem['entryType']): string {
  return ENTRY_TYPE_LABELS[value]
}

export function mileageStatusLabel(value: MileageHistoryItem['status']): string {
  return STATUS_LABELS[value]
}

/** 内部のイベント名をそのまま画面へ出さない。 */
export function mileageSourceLabel(value: string): string {
  return SOURCE_LABELS[value] ?? 'その他の自動処理'
}

/**
 * 発生元の補足行（設計 `MvZm5` 履歴 / `HIU5O` マイル明細）。
 *
 * **`調整元ID` を画面へ出さない。** 中身は問い合わせ番号や注文番号そのもの
 * （`INQ-20260823-018` `ORD-20260822-0007`）で、運用者がこの表で読む値では
 * ない。しかも枠に入らず途中で切れていた。**IDの断片は、IDより読めない。**
 *
 * この行に要るのは「元をたどれる記録が残っているか」だけなので、それだけを
 * 言葉で出す。番号そのものは、手で増減させるときの確認画面に出る。
 */
export function mileageSourceNoteText(input: {
  sourceReferenceId?: string | null
  hasSourceEvent: boolean
}): string {
  const hasReference = (input.sourceReferenceId ?? '').trim().length > 0
  return hasReference || input.hasSourceEvent ? '元の記録あり' : '元の記録なし'
}

/**
 * 明細表の1行。友だち向け履歴（`MileageHistoryItem`）は元記録の出来事IDを
 * 持つが、管理向け履歴API（`MileageAdminHistoryItem`）は有無だけしか返さない。
 * 管理系の行は `hasSourceEvent` を別途持ち、`sourceEventId` は空のままにする。
 */
export type MileageDetailHistoryItem = MileageHistoryItem & { hasSourceEvent?: boolean }

export function mileageDetailHasSourceEvent(item: MileageDetailHistoryItem): boolean {
  return item.hasSourceEvent ?? item.sourceEventId != null
}

/**
 * 管理向け履歴の行を明細表示の形へ移す。
 *
 * 管理向けAPIは元記録の出来事IDを返さないので、台帳行自身のIDを元記録IDへ
 * 偽装しない。有無だけを `hasSourceEvent` へ直通する(#816)。
 */
export function friendHistoryItem(item: MileageAdminHistoryItem): MileageDetailHistoryItem {
  return {
    id: item.id,
    entryType: item.entryType,
    status: item.status,
    amount: item.amount,
    reason: item.reason,
    source: item.source,
    sourceEventId: null,
    hasSourceEvent: item.hasSourceEvent,
    sourceReferenceId: item.sourceReferenceId,
    ruleName: item.ruleName,
    mode: item.mode,
    executedByStaffName: item.executedByStaffName,
    lineAccountId: item.lineAccountId ?? null,
    notificationStatus: item.notificationStatus ?? null,
    notificationErrorCode: item.notificationErrorCode ?? null,
    balanceAfter: item.balanceAfter,
    occurredAt: item.occurredAt,
  }
}

/**
 * 行動スコアの履歴理由を画面向けの言葉にする。
 * 内部のイベント名 `message_received` などをそのまま出さない。
 * `きっかけ → ルール名` の形ならルール名だけを出す。
 */
export function actionScoreReasonLabel(reason: string | null) {
  if (!reason) return '点数が変わった理由は未取得'
  const labels: Record<string, string> = {
    message_received: 'メッセージ返信',
    link_clicked: '配信URLクリック',
    form_submitted: '回答フォーム回答',
    booking_created: '予約',
    purchase_completed: '購入',
    friend_blocked: 'ブロック',
  }
  const [source, detail] = reason.split('→').map((part) => part.trim())
  if (labels[source]) return detail || labels[source]
  if (/^[a-z0-9_.-]+$/i.test(reason)) return '反応の記録'
  return reason
}

export function formatMileageChange(value: number): string {
  const number = formatNumber(Math.abs(value))
  if (value > 0) return `+${number}`
  if (value < 0) return `−${number}`
  return '0'
}

/** 数を日本語の桁区切りで出す。取れていない数・壊れた数は「—」にする。 */
export function formatMileageNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatNumber(value)
    : '—'
}

/**
 * R54: ランクの進みの1行目・2行目。未公開（今のランクも次のランクもなし。
 * 口の決まりでは公開中のランクが無いときだけ起きる）と、最高ランク到達を
 * 区別する。未公開の2行目は null を返し、呼び出し側で作り先の案内を出す
 * （理由の重ね書きにしない）。
 */
export function mileageRankProgress(input: {
  rank: string | null | undefined
  rankReason: string | null | undefined
  nextRankLabel: string | null | undefined
  milesToNextRank: number | null | undefined
}): { headline: string; detail: string | null; unpublished: boolean } {
  const rank = input.rank ?? null
  const nextRankLabel = input.nextRankLabel ?? null
  const loaded = input.rankReason != null
  const unpublished = loaded && !rank && !nextRankLabel
  const headline = nextRankLabel
    ? `次は「${nextRankLabel}」`
    : rank
      ? 'いちばん上のランクです'
      : (input.rankReason ?? 'ランク情報を確認できません')
  const detail = input.milesToNextRank != null
    ? `あと ${formatNumber(input.milesToNextRank)} マイル`
    : unpublished
      ? null
      : (input.rankReason ?? 'ランク情報を確認できません')
  return { headline, detail, unpublished }
}

export function formatMileageDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}
