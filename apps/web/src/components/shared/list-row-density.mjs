/** : count rendered text lines within each cell, never across columns. */
export function listRowContentLines(row) {
  const doc = row.ownerDocument
  const view = doc.defaultView
  if (!view) return 1
  let lines = 1
  for (const cell of row.children) {
    // A menu's visual preview occupies the same space as a two-line cell, even
    // when its caption is empty. Ignore interactive controls and their hit area.
    if ([...cell.querySelectorAll('img, video, [aria-hidden="true"]')].some(el =>
      !el.closest('button, a, [role="button"], .sr-only') && el.getBoundingClientRect().height > 36)) lines = Math.max(lines, 2)
    const centers = []
    const walker = doc.createTreeWalker(cell, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const parent = node.parentElement
      if (!parent || parent.closest('svg, script, style, [hidden], .sr-only, [role="menu"], [role="dialog"], [role="tooltip"]')) continue
      const css = view.getComputedStyle(parent)
      if (css.display === 'none' || css.visibility === 'hidden') continue
      const range = doc.createRange()
      range.selectNodeContents(node)
      if (typeof range.getClientRects !== 'function') continue
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue
        const center = rect.top + rect.height / 2
        // Small inline badges/units can have different baselines on the same line.
        if (!centers.some(value => Math.abs(value - center) < 7)) centers.push(center)
      }
    }
    lines = Math.max(lines, centers.length)
  }
  return Math.min(3, lines)
}
