/**
 * 巻く領域（左メニューの項目の並び）の中で、項目が上下とも見える所まで巻く。
 * scrollIntoView は外のページまで巻くので使わない。上下に 8px の余裕を残す。
 */
export function revealInScroller(scroller: HTMLElement, item: HTMLElement, margin = 8, anchor?: HTMLElement | null) {
  const box = scroller.getBoundingClientRect()
  const rect = item.getBoundingClientRect()
  if (box.height === 0 || rect.height === 0) return
  if (rect.top < box.top + margin) {
    scroller.scrollTop -= box.top + margin - rect.top
  } else if (rect.bottom > box.bottom - margin) {
    /*
     * 下へ巻くとき、項目の下端だけで合わせると上の端で見出しや行が半分に切れる（ の「メイン」）。
     * 項目の組（anchor）の頭を上端に置いても項目が見えるなら、組の頭で止める。
     */
    const anchorTop = anchor?.getBoundingClientRect().top
    const toAnchor = anchorTop === undefined ? null : anchorTop - (box.top + margin)
    const toItem = rect.bottom - (box.bottom - margin)
    scroller.scrollTop += toAnchor !== null && toAnchor >= toItem && rect.bottom - toAnchor <= box.bottom - margin ? toAnchor : toItem
  }
}
