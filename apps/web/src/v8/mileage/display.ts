/*
 * マイルの V8 画面が使う表示の言い換え・応答の検査。
 * app/mileage の mileage-display.ts・mileage-response-state.ts・
 * friends-overview-guard.ts・earning-rule-view.ts から写した（src/v8 は @/app を import できない）。
 * 古い側を直したら、ここも同じ判断を入れる（V8 へ切り替えるまでの二重管理）。
 */
import type { MileageAdminHistoryItem, MileageConnectedAccount, MileageFriendsV6Overview, MileageHistoryItem } from '@/lib/api'
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

/*
 * 短い日時（絵は「9/30 14:12」「10/2 15:20」）。日本時間に直して出す。
 * 端末の時差に振られないよう +9 時間ずらして読む。
 */
/* 月日だけ（絵は「9/30」。時刻なし）。日本時間に直して出す。 */
export function formatMileageMonthDay(value: string | null): string {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '—'
  const jst = new Date(time + 9 * 60 * 60 * 1000)
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`
}

export function formatMileageShortDateTime(value: string | null): string {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '—'
  const jst = new Date(time + 9 * 60 * 60 * 1000)
  const minutes = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${jst.getUTCHours()}:${minutes}`
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** API の入れ子が欠けたとき、未取得を 0 件として扱わない。 */
export function mileagePaginationTotal(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const pagination = (value as { pagination?: unknown }).pagination
  if (!pagination || typeof pagination !== 'object') return null
  return finiteNonNegativeNumber((pagination as { total?: unknown }).total)
}

/** 付与記録の回数が欠けたとき、画面全体を落とさず未取得として扱う。 */
export function mileageRewardedActions(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  return finiteNonNegativeNumber((value as { rewardedActions?: unknown }).rewardedActions)
}

/**
 * M503: CSV書き出しの失敗を、状態に合った運用者の言葉にする。
 * 通信断なのに権限の確認を案内しない。403 だけ権限、取れない応答は
 * 時間をおいての案内にする。共通部品は触らず、この画面だけで分ける。
 */
export function describeMileageCsvExportFailure(status: number | null): string {
  if (status === 403) return 'CSVを書き出せませんでした。権限を確認して、もう一度お試しください。'
  if (status === null) return 'CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'
  return 'CSVを書き出せませんでした。時間をおいて、もう一度お試しください。'
}

/** 未取得と、取得できた 0 件を区別したまま接続先を返す。 */
export function mileageConnectedAccounts(value: unknown): MileageConnectedAccount[] | null {
  if (!Array.isArray(value)) return null
  /*
   * R386: 同じアカウントの複数プロフィールを同じ本人へ結ぶと、接続先の
   * 一覧に同じアカウントが重なって返ることがある。表示はアカウント単位に
   * 絞り、同じアカウントIDの重複キー警告も防ぐ。
   */
  const seen = new Set<string>()
  return (value as MileageConnectedAccount[]).filter((connection) => {
    if (seen.has(connection.accountId)) return false
    seen.add(connection.accountId)
    return true
  })
}

/*
 * D022: 友だち残高の応答検査。描画が読む項目まで見る。
 *
 * `rankCounts`（・`monthChange`・`expiringMiles30d`・`measuredAt`）を欠く
 * 200応答が検査を通り抜けると、描画の `summary.rankCounts.length` で
 * 画面全体が落ちる。形が違うものは読み込めなかったものとして扱い、
 * 「読み込めませんでした」と再読み込みにする。
 */
export function isMileageFriendsV6Summary(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const summary = value as Partial<MileageFriendsV6Overview['summary']>
  return typeof summary.totalMembers === 'number'
    && typeof summary.withBalanceCount === 'number'
    && typeof summary.available === 'number'
    && typeof summary.pending === 'number'
    && typeof summary.monthChange === 'number'
    && Array.isArray(summary.rankCounts)
    && (typeof summary.expiringMiles30d === 'number' || summary.expiringMiles30d === null)
    && (summary.nextExpiringAt === null || typeof summary.nextExpiringAt === 'string')
}

export function isMileageFriendsV6Overview(value: unknown): value is MileageFriendsV6Overview {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MileageFriendsV6Overview>
  return Array.isArray(candidate.items)
    && isMileageFriendsV6Summary(candidate.summary)
    && !!candidate.pagination
    && typeof candidate.pagination.total === 'number'
    && typeof candidate.pagination.limit === 'number'
    && typeof candidate.pagination.offset === 'number'
    && typeof candidate.measuredAt === 'string'
}
/**
 * たまる決めごとの見せ方（設計 `N46cQ`）。
 *
 * 絞り込み・並び替え・CSV書き出しは各画面が V6 の口に合わせて持つ。
 * ここに残すのは、画面をまたいで使う表示の言い換えだけ。
 */

/** 未知のイベント名を内部語のまま運用者へ見せない。 */
export function ruleEventLabel(eventType: string, labels: Record<string, string>): string {
  return labels[eventType] ?? 'その他の行動'
}
