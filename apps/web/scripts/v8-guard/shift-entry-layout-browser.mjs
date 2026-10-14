/** 日ごとの休みを追加する4操作の間隔。状態を開いた時だけ測る。 */
export default function scanShiftEntrySpacing() {
  const findings = []
  const visible = element => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility !== 'visible' || node.hidden || node.hasAttribute('inert')) return false
    }
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }
  for (const entry of document.querySelectorAll('[data-shift-day-entry="closed"]')) {
    if (!visible(entry)) continue
    const expected = parseFloat(getComputedStyle(entry).getPropertyValue('--tpl-bks-row-gap'))
    if (!Number.isFinite(expected)) throw Error('Missing shared shift row gap')
    const boxes = [...entry.children].map((child, index) => {
      const control = visible(child) ? child : child.querySelector('input,button[aria-haspopup],button')
      if (!control || !visible(control)) return null
      const rect = control.getBoundingClientRect()
      return { index, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, name: control.getAttribute('aria-label') || control.querySelector('[aria-label]')?.getAttribute('aria-label') || control.textContent.trim() }
    }).filter(Boolean)
    const target = '[data-shift-day-entry="closed"]'
    if (boxes.length !== 4) findings.push({ kind: 'form-shift-entry-spacing', target, text: '休みの追加は種別・日付・理由・確定の4操作', measure: { controlsDifference: Math.abs(4 - boxes.length) } })
    const rows = []
    for (const box of boxes.sort((a,b) => a.top - b.top || a.left - b.left)) {
      let row = rows.find(row => Math.min(row.bottom, box.bottom) > Math.max(row.top, box.top))
      if (!row) { row = { top: box.top, bottom: box.bottom, boxes: [] }; rows.push(row) }
      row.bottom = Math.max(row.bottom, box.bottom); row.boxes.push(box)
    }
    const add = (gap, text) => { if (gap < expected - 1 / 64) findings.push({ kind: 'form-shift-entry-spacing', target, text, measure: { shortage: expected - gap } }) }
    for (const row of rows) {
      row.boxes.sort((a,b) => a.left - b.left)
      for (let index = 1; index < row.boxes.length; index++) add(row.boxes[index].left - row.boxes[index - 1].right, '並ぶ操作の間隔を共通の値へ')
    }
    for (let index = 1; index < rows.length; index++) add(rows[index].top - rows[index - 1].bottom, '入力の段の間隔を共通の値へ')
  }
  return findings
}
