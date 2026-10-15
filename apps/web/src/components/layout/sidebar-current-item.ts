/**
 * 巻く領域（左メニューの項目の並び）の中で、項目が上下とも見える所まで巻く。
 * scrollIntoView は外のページまで巻くので使わない。上下に 8px の余裕を残す。
 */
export function revealInScroller(scroller: HTMLElement, item: HTMLElement, margin = 8) {
  const box = scroller.getBoundingClientRect()
  const rect = item.getBoundingClientRect()
  if (box.height === 0 || rect.height === 0) return
  if (rect.top < box.top + margin) {
    scroller.scrollTop -= box.top + margin - rect.top
  } else if (rect.bottom > box.bottom - margin) {
    scroller.scrollTop += rect.bottom - (box.bottom - margin)
  }
}
