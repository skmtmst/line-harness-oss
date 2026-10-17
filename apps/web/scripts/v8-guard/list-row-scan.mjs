/** 一覧の省略時の全文・短い名前の折返し・タグのはみ出しを測る。 */
export function scanListRows() {
  const failures = []
  const visible = (element) => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element)
    return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('[aria-hidden="true"], [inert]')
  }
  const rows = [...document.querySelectorAll('tbody tr, [role="row"]:not([data-head])')].filter(visible)
  for (const row of rows) {
    for (const name of row.querySelectorAll('[data-list-name]')) {
      if (!visible(name)) continue
      const text = name.lastElementChild
      if (!text || !name.getAttribute('title') && !text.querySelector('[title]')) failures.push('B-194 名前の全文なし')
      const tops = []
      const textNodes = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
      while (textNodes.nextNode()) {
        const node = textNodes.currentNode
        if (!node.textContent.trim() || !visible(node.parentElement)) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const box of range.getClientRects()) if (box.width > 0 && box.height > 0) tops.push(box.top)
      }
      if (tops.length && Math.max(...tops) - Math.min(...tops) > 4) failures.push('B-194 名前の2行目')
    }
  }
  for (const tags of document.querySelectorAll('[data-tag-overflow]')) {
    if (!visible(tags)) continue
    if (tags.scrollWidth > tags.clientWidth + 1) failures.push('B-190 タグのはみ出し')
  }
  return { rows: rows.length, failures: [...new Set(failures)] }
}
