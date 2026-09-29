type BroadcastInsight = {
  delivered: number | null
  uniqueImpression: number | null
  uniqueClick: number | null
  suppressedByAudienceSize: boolean
} | null

/**
 * API の日時が欠けている・壊れているときに `Invalid Date` を画面へ出さない。
 * 配信日時は保存も運用も日本時間を基準にしているので、閲覧端末の時差に依存させない。
 */
export function formatBroadcastDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function percent(value: number, base: number): string {
  return `${Math.round((value / base) * 1000) / 10}%`
}

/**
 * 管理画面の送信件数とLINE側の集計は取得元が異なる。
 * 開封率だけを出すと、どの到達数を母数にしたのか判断できないため明記する。
 */
export function openInsightDetail(insight: BroadcastInsight): string {
  if (insight?.suppressedByAudienceSize) return '配信先が20人未満のため取れません'
  if (insight?.uniqueImpression == null || insight.delivered == null) return '—'
  if (insight.delivered === 0) return 'LINE集計の到達 0件（割合は算出できません）'
  return `LINE集計の到達 ${insight.delivered.toLocaleString('ja-JP')}件のうち ${percent(
    insight.uniqueImpression,
    insight.delivered,
  )}`
}

/**
 * クリックの断り。開封と同じ断り方をそろえる。
 *
 * 母数は「LINE集計の到達」。保存側（`broadcast_insights.click_rate`）も
 * `unique_click / delivered` で入れており、開封数を母数にした割合は
 * どこにも無い。画面だけ「開封のうち何%」と書くと、取っていない値を
 * その場で作ったことになる。
 */
export function clickInsightDetail(insight: BroadcastInsight): string {
  if (insight?.suppressedByAudienceSize) return '配信先が20人未満のため取れません'
  if (insight?.uniqueClick == null || insight.delivered == null) return '—'
  if (insight.delivered === 0) return 'LINE集計の到達 0件（割合は算出できません）'
  return `LINE集計の到達 ${insight.delivered.toLocaleString('ja-JP')}件のうち ${percent(
    insight.uniqueClick,
    insight.delivered,
  )}`
}
