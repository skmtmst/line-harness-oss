/**
 * 並び替えの画面側の道具（#1014 ATTR-02/03/04）。
 *
 * 絞り込み中に「見えている行だけ」を動かしても、見えていない行の位置を
 * 保ったまま全体の並びへ戻すのが `mergeVisibleOrder`。サーバー側の
 * `reorderTags` / `reorderFriendFields` / `reorderSupportMarks` /
 * `reorderSavedSearches` と同じ考え方で、楽観表示に使う。
 *
 * 保存は行ごとの PATCH ではなく `api.*.reorder` に1回で渡す。
 * 行ごとに送ると、途中で失敗したときに一部だけ新しい順位が残る
 * （ATTR-02/03 の「一部だけ更新されない」という合格条件を満たせない）。
 */

/**
 * `visibleAfter`（表示中の行を動かしたあとの順）を、`all` の中の
 * 対応する位置へ戻した全体の並びを返す。
 *
 * - 表示されていない行は、もといた位置にそのまま残る
 * - `pinned` が true の行（共通項目・共有マークなど動かせない行）も
 *   その位置に固定され、動かせる行だけが残る位置を埋め直す
 */
export function mergeVisibleOrder<T extends { id: string }>(
  all: T[],
  visibleAfter: T[],
  pinned?: (item: T) => boolean,
): T[] {
  const byId = new Map(all.map((item) => [item.id, item]))
  // `all` に無いIDは位置へ戻せないのでキューへ入れない。
  // 入れるとshiftだけ消費して後ろの割り当てが1つずれる。
  const movableAfter = visibleAfter.filter((item) => !pinned?.(item) && byId.has(item.id))
  const queue = movableAfter.map((item) => item.id)
  const movableVisible = new Set(queue)
  return all.map((item) => {
    if (pinned?.(item)) return item
    if (!movableVisible.has(item.id)) return item
    return byId.get(queue.shift()!) ?? item
  })
}

/**
 * `mergeVisibleOrder` で得た全体の並びから、サーバーへ送るID列を作る。
 * 動かせる行だけを新しい順で渡す。動かせない行・隠れた行は送らない。
 */
export function movableIds<T extends { id: string }>(
  merged: T[],
  movable: (item: T) => boolean,
): string[] {
  return merged.filter(movable).map((item) => item.id)
}
