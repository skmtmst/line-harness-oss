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

/** 使用先での絞り込み。設計 `QKx8Q` のツールバー2つめ。 */
export type SavedSearchUsageFilter = 'all' | 'used' | 'unused'

/**
 * 一覧の絞り込み（設計 `QKx8Q` の「条件名・用途で検索」「使用先：すべて」）。
 *
 * どちらも**すでに読み込んだ一覧の中だけ**で効かせる。新しい口は要らない。
 *
 * 使用先が未取得（`usedIn` が無い）の行は、使用中とも未使用とも言えない。
 * どちらの絞り込みでも**消さずに残す**。消すと「未使用だけ」で出した一覧が
 * 実は使用中の条件を隠していた、ということが起きる。
 */
export function filterSavedSearches<T extends Pick<SavedSearch, 'name' | 'usedIn'>>(
  items: T[],
  query: string,
  usage: SavedSearchUsageFilter,
): T[] {
  const needle = query.trim().toLocaleLowerCase('ja')
  return items.filter((item) => {
    if (needle && !item.name.toLocaleLowerCase('ja').includes(needle)) return false
    if (usage === 'all' || item.usedIn === undefined) return true
    return usage === 'used' ? item.usedIn.length > 0 : item.usedIn.length === 0
  })
}
