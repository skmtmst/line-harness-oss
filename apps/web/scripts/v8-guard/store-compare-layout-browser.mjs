/** 店の比較で、平均との差の札が数値や隣のマスへ重ならないか測る。 */
export default function scanStoreCompareLayout() {
  const findings = []
  const visible = el => { const r = el.getBoundingClientRect(), c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden' }
  const cells = [...document.querySelectorAll('[class*="cell__"]')].filter(el => visible(el) && el.querySelector('[class*="delta-chip_root__"]'))
  for (const cell of cells) {
    const chip = cell.querySelector('[class*="delta-chip_root__"]'), chipRect = chip.getBoundingClientRect()
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || chip.contains(node.parentElement)) continue
      const range = document.createRange(); range.selectNodeContents(node)
      const value = range.getBoundingClientRect()
      if (value.width > 0 && value.height > 0 && value.right > chipRect.left && chipRect.right > value.left && value.bottom > chipRect.top && chipRect.bottom > value.top) findings.push({ kind: 'store-compare-delta-overlap', target: cell.textContent?.trim() ?? '', measure: { value: value.toJSON(), chip: chipRect.toJSON() } })
      break
    }
    const cellRect = cell.getBoundingClientRect()
    if (chipRect.left < cellRect.left - 0.5 || chipRect.right > cellRect.right + 0.5) findings.push({ kind: 'store-compare-delta-overflow', target: cell.textContent?.trim() ?? '', measure: { left: cellRect.left - chipRect.left, right: chipRect.right - cellRect.right } })
  }
  for (let i = 0; i < cells.length; i += 1) for (let j = i + 1; j < cells.length; j += 1) {
    const a = cells[i].getBoundingClientRect(), b = cells[j].getBoundingClientRect(), width = Math.min(a.right, b.right) - Math.max(a.left, b.left), height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    if (width > 0.5 && height > 0.5) findings.push({ kind: 'store-compare-cell-overlap', target: `${cells[i].textContent?.trim()} | ${cells[j].textContent?.trim()}`, measure: { width, height } })
  }
  return findings
}
