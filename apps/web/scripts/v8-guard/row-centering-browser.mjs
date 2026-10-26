/**
 * 印＋文字（＋右の文字・ボタン）の行で、印・文字のかたまり・右の物の上下の真ん中が 1px を超えてずれたら落とす
 * （2026-10-27 オーナー指摘：友だちの詳細の行で文字が真ん中からずれていた）。page.evaluate で単独に動く。
 *
 * 見る行：
 * - 共通の行（`[data-center-row]`）の印・文字・右（`[data-center-row-part]`）
 * - 手書きの行：横並びの箱（flex の横・grid）で、直下に「印」（中が svg だけ・40px 以下）と
 *   「文字のかたまり」（文字を持つ要素）を持ち、高さが 40〜96px の物。直下のボタンも比べる
 * ボタン・入力欄そのもの（中の印と文字）は対象外。上そろえの複数行の本文（高さ 96px 超）も対象外。
 */
export default function scanRowCentering() {
  const findings = []
  const root = document.querySelector('main') || document.body
  const shown = el => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    for (let p = el; p; p = p.parentElement) {
      const c = getComputedStyle(p)
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false
    }
    return true
  }
  const selector = el => {
    const parts = []
    for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/).filter(Boolean)[0] : ''
      const siblings = p.parentElement ? [...p.parentElement.children].filter(s => s.tagName === p.tagName) : [p]
      parts.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : '') + ':nth-of-type(' + (siblings.indexOf(p) + 1) + ')')
    }
    return parts.join(' > ')
  }
  // 見える物の上下の真ん中。文字は文字そのものの範囲（空の段・余白を含めない）、印とボタンは箱で測る。
  const center = el => {
    if (!el.matches('button,a[href],[role="button"]') && !(el.children.length === 1 && el.firstElementChild.matches('button,a[href],[role="button"]'))) {
      if (el.matches('svg') || (el.textContent ?? '').trim() === '') { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }
      let top = Infinity, bottom = -Infinity
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const r of range.getClientRects()) if (r.height > 0) { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom) }
      }
      if (top !== Infinity) return (top + bottom) / 2
    }
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2
  }
  const isIcon = el => {
    if (el.matches('button,a,input,select,textarea,[role="button"]')) return false
    const r = el.getBoundingClientRect()
    if (r.width > 40 || r.height > 40) return false
    if (el.tagName.toLowerCase() === 'svg') return true
    return (el.textContent ?? '').trim() === '' && el.querySelector('svg') !== null
  }
  const isText = el => !el.matches('svg') && (el.textContent ?? '').trim() !== '' && !el.matches('button,input,select,textarea')
  const isAction = el => el.matches('button,a[href],[role="button"]') || (el.children.length === 1 && el.firstElementChild.matches('button,a[href],[role="button"]'))
  const check = (row, icon, others) => {
    if (!icon || !shown(icon)) return
    const c = center(icon)
    for (const other of others) {
      if (!shown(other)) continue
      const diff = Math.abs(center(other) - c)
      if (diff > 1) {
        findings.push({ kind: 'row-offcenter', target: selector(row), other: selector(other), text: (row.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), measure: { offset: Math.round(diff * 10) / 10 } })
        return
      }
    }
  }
  const marked = new Set(root.querySelectorAll('[data-center-row]'))
  for (const row of marked) {
    if (!shown(row)) continue
    const parts = [...row.querySelectorAll(':scope > [data-center-row-part]')]
    check(row, parts.find(p => p.dataset.centerRowPart === 'icon'), parts.filter(p => p.dataset.centerRowPart !== 'icon'))
  }
  for (const row of root.querySelectorAll('*')) {
    if (marked.has(row) || row.closest('[data-center-row]') || row.matches('button,a,label,input,select,textarea,svg,svg *,[role="button"],th,td,[role="cell"],[role="gridcell"],[role="columnheader"]')) continue
    const c = getComputedStyle(row)
    const across = (c.display.includes('flex') && !c.flexDirection.startsWith('column')) || c.display.includes('grid')
    if (!across) continue
    const r = row.getBoundingClientRect()
    if (r.height < 40 || r.height > 96 || !shown(row)) continue
    const kids = [...row.children].filter(k => getComputedStyle(k).position !== 'absolute' && getComputedStyle(k).position !== 'fixed')
    const icon = kids.find(isIcon)
    if (!icon) continue
    const texts = kids.filter(k => k !== icon && isText(k) && !isAction(k))
    if (!texts.length) continue
    check(row, icon, [...texts, ...kids.filter(k => k !== icon && isAction(k))])
  }
  return findings
}
