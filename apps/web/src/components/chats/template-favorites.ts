/**
 * よく使うテンプレート（設計 `NWbuF` の★）。
 *
 * **前は「先頭5件」を「よく使う」と呼んでいた。** `filtered.slice(0, 5)` で、
 * 使った回数も、選んだ覚えも見ていない。並び順が変われば中身も変わる。
 * 使っていないひな形に「☆ よく使う」と出るので、**測っていないことを
 * 測ったように見せていた。**
 *
 * 設計は★を押して自分で登録する形なので、そのとおりにする。
 * 登録先はこの端末（`localStorage`）。人ごと・端末ごとに違ってよいものなので、
 * 読み口は要らない。
 */
const KEY = 'chat.templateFavorites.v1'

/** 端末に残っている★。読めなければ空。**落とすより空で続けるほうがよい。** */
export function readFavorites(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function writeFavorites(ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]))
  } catch {
    // 残せなくても、その場の絞り込みは効く。
  }
}

/** 押すたびに入れ替える。 */
export function toggleFavorite(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
}

/**
 * ★だけに絞る。
 *
 * **1件も登録が無いときに「先頭5件」で埋めない。** 埋めると、登録した
 * つもりが無いのに「よく使う」が並び、★の意味が分からなくなる。
 */
export function filterFavorites<T extends { id: string }>(items: T[], favorites: string[]): T[] {
  return items.filter((item) => favorites.includes(item.id))
}

/** 更新日。読めなければ「—」。 */
export function updatedLabel(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '—'
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo',
  }).format(date)
}
