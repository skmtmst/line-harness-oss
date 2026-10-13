/** ブラウザの中で実行する。文字列だけでなく、効いた色と行の高さも見る。 */
export function scanListRows() {
  const failures = []
  const visible = (element) => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element)
    return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('[aria-hidden="true"], [inert]')
  }
  const rows = [...document.querySelectorAll('tbody tr, [role="row"]:not([data-head])')].filter(visible)
  for (const row of rows) {
    for (const button of row.querySelectorAll('button, a')) {
      if (visible(button) && !button.closest('[role="menu"], [role="dialog"]') && /^(?:編集(?:する|を続ける)?|内容を編集)$/.test(button.textContent.trim())) failures.push('B-193 行の右の編集')
    }
    for (const element of row.querySelectorAll('a, button, span')) {
      if (!visible(element) || element.closest('[role="menu"], [data-design-node="xRvDB"], [data-status-pill]')) continue
      const color = getComputedStyle(element).color
      if (/rgb\((?:37, 99, 235|11, 99, 206|23, 92, 211|29, 78, 216)\)/.test(color)) failures.push('B-198 表の青い文字')
    }
    for (const name of row.querySelectorAll('[data-list-name]')) {
      if (!visible(name)) continue
      if (name.querySelectorAll('[data-folder-dot]').length !== 1) failures.push('B-194 名前の丸なし')
      const cell = name.closest('td, [role="cell"]')
      if (cell?.querySelector('[data-design-node="xRvDB"], [data-status-pill]')) failures.push('B-194 名前の中の状態')
      if (cell) {
        const outside = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
        while (outside.nextNode()) {
          const node = outside.currentNode
          if (node.textContent.trim() && !node.parentElement.closest('[data-list-name]') && visible(node.parentElement) && !node.parentElement.closest('[role="menu"], [aria-hidden="true"]')) failures.push('B-194 名前の2行目')
        }
      }
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
  for (const number of document.querySelectorAll('[data-kpi-number]')) {
    if (!visible(number)) continue
    const text = number.textContent.trim()
    if (text !== '—' && !/^[+−\-¥￥$€£]?\s*\d[\d,.:/\s%％+−\-¥￥$€£]*?(?:(?:人|名|件|通|組|回|円|枠|席|社|個|枚|マス|時間|分|秒|日|月|年)[\d,.:/\s]*)*$/.test(text)) failures.push('B-195 数の帯の言葉')
  }
  for (const tags of document.querySelectorAll('[data-tag-overflow]')) {
    if (!visible(tags)) continue
    if (tags.scrollWidth > tags.clientWidth + 1) failures.push('B-190 タグのはみ出し')
  }
  return { rows: rows.length, failures: [...new Set(failures)] }
}
