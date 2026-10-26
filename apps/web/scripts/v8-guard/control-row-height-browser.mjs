/**
 * 1 つの操作の段（一覧の道具の段・予約表の上の段など）に並ぶボタン・プルダウン・切り替え・探す欄は、
 * 同じ高さ（共通の値 --control-h）にそろえる。同じ行に並んだ操作の高さが 0.5px を超えて違えば落とす。
 */
export default function scanControlRowHeights() {
const ROW = '[data-toolbar-row],[data-control-row]'
const CONTROL = [
  'button', 'select', '[role="combobox"]', '[aria-haspopup]',
  'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])',
  '[data-choice-field]', '[data-search-field]', '[data-segmented-control]', '[data-entity-picker-field]',
].join(',')


  const findings = []
  const visible = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const c = getComputedStyle(p)
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0 || p.hasAttribute('inert')) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)
  for (const row of document.querySelectorAll(ROW)) {
    if (!visible(row) || row.closest('[role="dialog"],[role="menu"],[role="listbox"]')) continue
    const controls = [...row.querySelectorAll(CONTROL)].filter((el) => {
      if (el.closest(ROW) !== row || el.closest('[role="menu"],[role="listbox"],[role="dialog"],[role="tooltip"]')) return false
      const outer = el.parentElement?.closest(CONTROL)
      if (outer && row.contains(outer)) return false
      return visible(el) && el.getBoundingClientRect().height >= 24
    })
    const lines = []
    for (const el of controls) {
      const r = el.getBoundingClientRect()
      const line = lines.find((entry) => Math.min(entry.bottom, r.bottom) - Math.max(entry.top, r.top) > Math.min(entry.bottom - entry.top, r.height) / 2)
      if (line) {
        line.items.push({ el, h: r.height })
        line.top = Math.min(line.top, r.top)
        line.bottom = Math.max(line.bottom, r.bottom)
      } else lines.push({ top: r.top, bottom: r.bottom, items: [{ el, h: r.height }] })
    }
    for (const line of lines) {
      if (line.items.length < 2) continue
      const heights = line.items.map((item) => Math.round(item.h * 2) / 2)
      if (Math.max(...heights) - Math.min(...heights) <= 0.5) continue
      findings.push({ kind: 'rowheight', target: line.items.map((item) => name(item.el)).join(' | '), text: '', measure: { heights } })
    }
  }
  return findings
}
