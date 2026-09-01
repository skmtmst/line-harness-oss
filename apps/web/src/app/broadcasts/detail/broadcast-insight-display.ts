type BroadcastInsight = {
  delivered: number | null
  uniqueImpression: number | null
  suppressedByAudienceSize: boolean
} | null

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
