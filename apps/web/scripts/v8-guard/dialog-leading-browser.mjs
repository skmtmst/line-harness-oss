/** 名前や窓ごとの例外に頼らず、補助操作と主操作の実際の箱を測る。 */
export function scanLeadingActions() {
  const rows = []
  const visible = node => node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden'
  const controls = node => [...node.querySelectorAll('button, a[href], [role="combobox"]')].filter(visible).filter((item, _, all) => !all.some(parent => parent !== item && parent.contains(item)))
  for (const root of document.querySelectorAll('[data-dialog-actions]')) {
    const leading = root.querySelector('[data-dialog-action-leading]')
    if (!leading || !visible(root)) continue
    const main = leading.nextElementSibling, errors = [], left = controls(leading), primary = controls(main)
    const r = root.getBoundingClientRect(), style = getComputedStyle(root)
    const bounds = { left: r.left + parseFloat(style.paddingLeft), right: r.right - parseFloat(style.paddingRight) }
    const first = primary[0]?.getBoundingClientRect(), lead = left[0]?.getBoundingClientRect()
    const all = [...left, ...primary]
    if (leading.scrollWidth > leading.clientWidth + 1) errors.push('補助操作が左の列からはみ出す')
    for (const item of all) {
      const box = item.getBoundingClientRect()
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1) errors.push('操作が帯からはみ出す')
      if (item.scrollWidth > item.clientWidth + 1) errors.push('操作の文字が切れる')
    }
    const walker = document.createTreeWalker(leading, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.textContent.trim() || node.parentElement.closest('button, a[href]')) continue
      const range = document.createRange(); range.selectNodeContents(node)
      for (const text of range.getClientRects()) for (const item of primary) {
        const box = item.getBoundingClientRect()
        if (Math.min(text.right, box.right) - Math.max(text.left, box.left) > 1 && Math.min(text.bottom, box.bottom) - Math.max(text.top, box.top) > 1) errors.push('補足の文字が主操作に重なる')
      }
    }
    for (const [index, item] of all.entries()) for (const other of all.slice(index + 1)) {
      const a = item.getBoundingClientRect(), b = other.getBoundingClientRect()
      const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (horizontal > 1 && vertical > 1) errors.push('操作が重なる')
      else if (vertical > 1 && Math.max(b.left - a.right, a.left - b.right) < 7.9) errors.push('操作の間が8px未満')
      else if (horizontal > 1 && Math.max(b.top - a.bottom, a.top - b.bottom) < 7.9) errors.push('操作の縦の間が8px未満')
    }
    const stacked = root.hasAttribute('data-dialog-actions-stacked')
    if (stacked) {
      const l = leading.getBoundingClientRect(), m = main.getBoundingClientRect()
      if (m.top - l.bottom < 7.9) errors.push('上下の操作の間が8px未満')
      if (left.length && Math.abs(left[0].getBoundingClientRect().left - bounds.left) > 1) errors.push('補助操作が左にそろわない')
    } else if (first && lead && Math.abs((first.top + first.bottom - lead.top - lead.bottom) / 2) > 1) errors.push('最初のボタン行の中心がそろわない')
    if (main) {
      const m = main.getBoundingClientRect()
      if (main.scrollWidth > main.clientWidth + 1) errors.push('主操作が中央の列からはみ出す')
      if (Math.abs((m.left + m.right - bounds.left - bounds.right) / 2) > 1) errors.push('主操作が中央にない')
      for (const item of primary) {
        const box = item.getBoundingClientRect()
        if (box.left < m.left - 1 || box.right > m.right + 1) errors.push('主操作が中央の列からはみ出す')
      }
      const lines = []
      for (const item of primary) {
        const box = item.getBoundingClientRect()
        let line = lines.find(line => Math.abs(line.top - box.top) <= 1)
        if (!line) { line = { top: box.top, left: box.left, right: box.right }; lines.push(line) }
        line.left = Math.min(line.left, box.left); line.right = Math.max(line.right, box.right)
      }
      if (lines.some(line => Math.abs((line.left + line.right - bounds.left - bounds.right) / 2) > 1)) errors.push('主操作の行が中央にない')
    }
    if (root.scrollWidth > root.clientWidth + 1) errors.push('操作帯が横にはみ出す')
    rows.push({ errors, stacked, left: left.map(item => item.textContent.trim()), primary: primary.map(item => item.textContent.trim()), first: first?.toJSON(), lead: lead?.toJSON(), width: r.width })
  }
  return rows
}
