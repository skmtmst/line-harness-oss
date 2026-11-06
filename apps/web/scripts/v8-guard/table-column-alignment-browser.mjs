/** PC tables compare columns horizontally, including multi-line cell content. */
export default function scanTableColumnAlignment() {
  const visible = el => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      && !el.closest('[hidden], [inert]')
  }
  const findings = [], coverage = []
  for (const table of document.querySelectorAll('main table')) {
    if (!visible(table)) continue
    const headers = [...table.querySelectorAll('thead tr')]
    if (!headers.some(row => row.children.length >= 3)) continue
    const label = table.getAttribute('aria-label') ?? headers[0]?.textContent.trim() ?? ''
    let measured = 0
    for (const [index, row] of [...table.rows].entries()) {
      const cells = [...row.cells].filter(visible)
      if (cells.length < 3 || cells.some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) continue
      const rects = cells.map(cell => cell.getBoundingClientRect())
      measured++
      const overlap = Math.min(...rects.map(rect => rect.bottom)) - Math.max(...rects.map(rect => rect.top))
      const ordered = rects.every((rect, i) => i === 0 || rect.left >= rects[i - 1].right - 1)
      if (overlap <= 0 || !ordered) findings.push({
        kind: 'table-columns-stacked', label, row: index,
        text: cells.map(cell => cell.textContent.trim()), overlap, ordered,
      })
    }
    coverage.push({ label, rows: measured })
  }
  return { findings, coverage }
}
