/** detect.cjs (/192) の実寸判定。page.evaluate で単独に動く。 */
export default function scanLayoutDefects() {
  const findings = []
  const root = document.querySelector('main') || document.body
  const style = new Map()
  const css = el => { if (!style.has(el)) style.set(el, getComputedStyle(el)); return style.get(el) }
  const visible = el => {
    for (let p = el; p; p = p.parentElement) {
      // 閉じたdetailsの本文は寸法が残っても描画されない。見出しは引き続き測る。
      if (p !== el && p.matches('details:not([open])') && !p.querySelector(':scope > summary')?.contains(el)) return false
      const c = css(p)
      if (c.display === 'none' || c.visibility === 'hidden' || c.visibility === 'collapse' || +c.opacity === 0) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const excluded = el => {
    // 編集欄もbubbleという名前を持つ。LINEの見本の除外を入力欄へ広げない。
    for (let p = el; p; p = p.parentElement) {
      const name = p.getAttribute('data-pencil-name') || ''
      const classes = typeof p.className === 'string' ? p.className : ''
      if (p.matches('nav,script,style,noscript,svg,[data-template-region="folders"],[data-template-region="collapsed-folders"],[data-line-preview-part="talk"]') ||
          /フォルダの列|左メニュー/.test(name) || /(?:^|[ _-])(?:bubbleBody|bubbleText|bubbleIn|bubbleOut|messageBubble|bubble)(?:[_ -]|$)/i.test(classes) && !p.closest('[data-message-composer]')) return true
    }
    return false
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
  const add = (kind, el, text, measure, other) => findings.push({ kind, target: selector(el), ...(other ? { other: selector(other) } : {}), text: text.replace(/\s+/g, ' ').slice(0, 120), measure })
  // Range は省略・行数制限で隠れた文字の寸法も返す。重なりは実際に見える
  // 各行だけで比べる。切れの検査には、後段で省略前の寸法を使う。
  const paintedRects = (rects, el) => rects.map(r => {
    let left = r.left, right = r.right, top = r.top, bottom = r.bottom
    for (let p = el; p && p !== root; p = p.parentElement) {
      const c = css(p), box = p.getBoundingClientRect()
      if (c.overflowX !== 'visible') { left = Math.max(left, box.left); right = Math.min(right, box.right) }
      if (c.overflowY !== 'visible') { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
    }
    return { left, right, top, bottom, width: right - left, height: bottom - top }
  }).filter(r => r.width > 0 && r.height > 0)
  // 不透明な追従バーの裏にある文字は同時には見えない。透明な帯や、
  // 帯の中で重なる文字は引き続き検査する。重なった領域の四隅で前後も確認する。
  const coveredBySticky = (front, back, rect) => {
    for (let p = front; p && p !== root; p = p.parentElement) {
      const c = css(p)
      if (c.position !== 'sticky' || p.contains(back) || +c.opacity !== 1) continue
      const rgba = c.backgroundColor.match(/[\d.]+/g)
      if (!rgba || rgba.length < 3 || rgba.length > 3 && +rgba[3] < 1) continue
      const points = [[rect.left + .5, rect.top + .5], [rect.right - .5, rect.top + .5],
        [rect.left + .5, rect.bottom - .5], [rect.right - .5, rect.bottom - .5]]
      if (points.every(([x,y]) => p.contains(document.elementFromPoint(x,y)))) return true
    }
    return false
  }
  const leaves = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode, el = node.parentElement, text = node.textContent.trim()
    if (!text || !visible(el) || excluded(el)) continue
    const range = document.createRange(); range.selectNodeContents(node)
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
    if (!rects.length) continue
    const bb = range.getBoundingClientRect()
    const painted = paintedRects(rects, el)
    if (!painted.length) continue
    const lines = new Set(painted.map(r => Math.round(r.top / 4))).size
    let layer = el
    while (layer && layer !== document.body) {
      if (/^(absolute|fixed)$/.test(css(layer).position)) break
      layer = layer.parentElement
    }
    leaves.push({ el, text, rects: painted, lines, layer })
    // Wrapping is a defect for short labels and names, not prose. Use semantic
    // roles instead of punctuation, page-specific selectors or allowed text.
    const label = el.closest('button,a,label,legend,h1,h2,h3,h4,h5,h6,th,[role="button"],[role="heading"],[role="tab"],[role="columnheader"],[data-list-name],[data-list-date-time],[data-list-number],[data-kpi-number],[data-select-value],[data-status-pill],[data-page-title]')
    const prose = el.closest('p,pre,textarea,[contenteditable]')
    const shortLabel = label && (!prose || prose.contains(label))
    const explanation = el.closest('small,[role="note"]')
    if (shortLabel && !explanation && lines >= 2 && text.length <= 24) add('wrap', el, text, { lines })
    if (lines >= 2 && text.length / lines <= 2.5) add('squash', el, text, { lines })
    // 正規の1行省略は既存 layout-overflow の title 検査に任せる。
    const ellipsis = (() => { for (let p = el; p && p !== root; p = p.parentElement) if (css(p).textOverflow === 'ellipsis') return true; return false })()
    if (!ellipsis) {
      let p = el.parentElement
      while (p && p !== document.body) {
        const c = css(p)
        if (c.overflow !== 'visible' || c.overflowX !== 'visible') {
          const pr = p.getBoundingClientRect()
          const excess = Math.max(bb.right - pr.right, pr.left - bb.left)
          if (excess > 2) add('clip', el, text, { excess: Math.ceil(excess) }, p)
          break
        }
        p = p.parentElement
      }
    }
  }
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j]
    if (a.layer !== b.layer || a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue
    let overlap = null
    for (const ar of a.rects) for (const br of b.rects) {
      const x = Math.min(ar.right, br.right) - Math.max(ar.left, br.left)
      const y = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top)
      if (x > 2 && y > 3) {
        const rect = { left: Math.max(ar.left,br.left), right: Math.min(ar.right,br.right), top: Math.max(ar.top,br.top), bottom: Math.min(ar.bottom,br.bottom) }
        if (coveredBySticky(a.el,b.el,rect) || coveredBySticky(b.el,a.el,rect)) continue
        if (!overlap || x * y > overlap.x * overlap.y) overlap = { x, y }
      }
    }
    if (overlap) add('overlap', a.el, a.text + ' ⟂ ' + b.text, { x: Math.ceil(overlap.x), y: Math.ceil(overlap.y) }, b.el)
  }
  return findings
}
