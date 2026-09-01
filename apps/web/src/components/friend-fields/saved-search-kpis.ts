import type { SavedSearch } from '@line-crm/shared'

export type SavedSearchKpiValues = {
  total: number | null
  usedInBroadcasts: number | null
  zeroMatches: number | null
  callsThisMonth: number | null
}

/**
 * 保存した検索の上部4指標。
 *
 * 一覧の取得に失敗したときは、空の一覧と区別するため全て null にする。
 * また、使用先や該当人数が1件でも未取得なら、合計を少なく見せず null にする。
 */
export function savedSearchKpiValues(
  items: Array<Pick<SavedSearch, 'matchCount' | 'usedIn'>>,
  available: boolean,
): SavedSearchKpiValues {
  if (!available) {
    return { total: null, usedInBroadcasts: null, zeroMatches: null, callsThisMonth: null }
  }

  const usageKnown = items.every((item) => item.usedIn !== undefined)
  const matchKnown = items.every((item) => typeof item.matchCount === 'number')

  return {
    total: items.length,
    usedInBroadcasts: usageKnown
      ? items.filter((item) => item.usedIn?.some((usage) => usage.kind === 'broadcast')).length
      : null,
    zeroMatches: matchKnown
      ? items.filter((item) => item.matchCount === 0).length
      : null,
    // 呼び出し履歴はまだAPIに無い。設計の84回を固定値では置かない。
    callsThisMonth: null,
  }
}
