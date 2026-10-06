import type { Tag, TagGroup } from '@line-crm/shared'

export type TagOptionGroup = {
  /** フォルダの id。未分類は `null`。 */
  id: string | null
  label: string
  tags: Tag[]
}

/**
 * タグをフォルダごとに束ねる。
 *
 * **平らに並べると選べない。** 実データでは「VIPタグ 1〜13」
 * 「ペットタグ 1〜12」「会員タグ 1〜9」のように似た名前が続くので、
 * どの群から選ぶのかを先に決められるようにする。
 *
 * 決めごと：
 * - **フォルダが取れないときは束ねない**（`groups` が空なら1つの束で返す）。
 *   束ねられないだけで、タグを選べなくする理由はない。
 * - フォルダの並びは `sortOrder`。同じなら名前順。
 * - **どのフォルダにも属さないタグは「未分類」へまとめ、最後に置く。**
 * - **タグが1つも入っていないフォルダは出さない。**選べないものを見せない。
 */
export function groupTagsByFolder(tags: Tag[], groups: TagGroup[]): TagOptionGroup[] {
  if (groups.length === 0) {
    return tags.length ? [{ id: null, label: '', tags }] : []
  }

  const ordered = [...groups].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja'),
  )
  const known = new Set(ordered.map((g) => g.id))
  const out: TagOptionGroup[] = []

  for (const group of ordered) {
    const inGroup = tags.filter((t) => t.groupId === group.id)
    if (inGroup.length) out.push({ id: group.id, label: group.name, tags: inGroup })
  }

  const unfiled = tags.filter((t) => !t.groupId || !known.has(t.groupId))
  if (unfiled.length) out.push({ id: null, label: '未分類', tags: unfiled })

  return out
}
