/**
 * 1 つの操作の段（一覧の道具の段・予約表の上の段など）に並ぶボタン・プルダウン・切り替え・探す欄は、
 * 同じ高さ（共通の値 --control-h）にそろえる。同じ行に並んだ操作の高さが 0.5px を超えて違えば落とす。
 */
export default function scanControlRowHeights() {
const ROW = '[data-toolbar-row],[data-control-row]'
const CONTROL = [
  'button', 'select', 'a[href]', '[role="button"]', '[role="switch"]', '[role="combobox"]', '[aria-haspopup]',
  'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])',
  '[data-search-field]', '[data-segmented-control]', '[data-entity-picker-field]',
].join(',')


  const findings = []
  const visible = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const c = getComputedStyle(p)
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0 || p.hasAttribute('inert')) return false
      if (p.matches('details:not([open])') && !p.querySelector(':scope > summary')?.contains(el)) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)
  for (const el of document.querySelectorAll('button,a[href],[role="button"]')) {
    const rect = el.getBoundingClientRect()
    let hidden = Boolean(el.closest('[hidden],[inert],[aria-hidden="true"]'))
    for (let parent = el; parent && !hidden; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      hidden = style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0 || parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(el)
    }
    if (hidden) continue
    if (rect.width > 0 && rect.height > 0) continue
    findings.push({ kind: 'zero-control-hit-area', target: name(el), text: '', measure: { width: rect.width, height: rect.height } })
  }
  for (const row of document.querySelectorAll(ROW)) {
    if (!visible(row) || row.closest('[role="dialog"],[role="menu"],[role="listbox"]')) continue
    const controls = [...row.querySelectorAll(CONTROL)].filter((el) => {
      if (el.closest(ROW) !== row || el.closest('[role="menu"],[role="listbox"],[role="dialog"],[role="tooltip"]')) return false
      const outer = el.parentElement?.closest(CONTROL)
      if (outer && row.contains(outer)) return false
      return visible(el)
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
      if (Math.max(...line.items.map(item => item.h)) - Math.min(...line.items.map(item => item.h)) <= 0.5) continue
      findings.push({ kind: 'rowheight', target: line.items.map((item) => name(item.el)).join(' | '), text: '', measure: { heights } })
    }
  }
  return findings
}
