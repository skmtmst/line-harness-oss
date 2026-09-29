/**
 * 回答フォームのページ（セクション）名の整形。
 *
 * 取り消し・空・空白だけは元のままにする（空のページ名は作らせない）。
 * 長さ上限は口・画面のどこにも無いので切らない。
 */
export function normalizeSectionName(next: string | null): string | null {
  if (next === null) return null
  const trimmed = next.trim()
  if (!trimmed) return null
  return trimmed
}
