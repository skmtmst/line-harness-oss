/** 描画された箱が親の切り抜きで欠けていないかを測る。 */
export default function scanOwnerRules() {
  const findings = [], root = document.querySelector('main') || document.body
  const styles = new Map()
  const css = el => { if (!styles.has(el)) styles.set(el, getComputedStyle(el)); return styles.get(el) }
  const visible = el => {
    for (let p = el; p; p = p.parentElement) {
      // 閉じた設定は描画されない。開いた設定とsummaryは検査する。
      if (p !== el && p.matches('details:not([open])') && !p.querySelector(':scope > summary')?.contains(el)) return false
      const c = css(p)
      if (c.display === 'none' || c.visibility === 'hidden' || c.visibility === 'collapse' || +c.opacity === 0 || c.clipPath === 'inset(50%)' || /^rect\(0px[, ]+0px[, ]+0px[, ]+0px\)$/.test(c.clip) || p.hasAttribute('inert')) return false
    }
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
  }
  const selector = el => {
    const parts = []
    for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : ''
      const peers = p.parentElement ? [...p.parentElement.children].filter(s => s.tagName === p.tagName) : [p]
      parts.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : '') + ':nth-of-type(' + (peers.indexOf(p)+1) + ')')
    }
    return parts.join(' > ')
  }
  const add = (kind, el, measure, text = '', other) => findings.push({kind,target:selector(el),text:text.replace(/\s+/g,' ').slice(0,120),measure,...(other?{other:selector(other)}:{})})
  const hasBorder = c => ['Top','Right','Bottom','Left'].every(side => c[`border${side}Style`] !== 'none' && parseFloat(c[`border${side}Width`]) > 0) || c.boxShadow !== 'none'
  // 小窓・吹き出し・通知はmainの外へ描かれる。面の検査はその口にも届かせる。
  const portals = [...document.querySelectorAll('[role="dialog"],[role="tooltip"],[aria-label="知らせ"]')]
  const surfaces = [...new Set([root,...root.querySelectorAll('*'),...portals.flatMap(el => [el,...el.querySelectorAll('*')])])]
  for (const el of surfaces.filter(visible)) {
    const c = css(el), r = el.getBoundingClientRect(), name = el.getAttribute('data-pencil-name') || ''
    // 時間×卓、スマホの見え方、画像そのものは意図した端接触。ALLOW.tsvと同じ対象限定。
    // 古いbaseにも同じ判定を当てる。共通部品の既存の印も読む。
    const phone = el.closest('[data-line-preview-part],[class*="line-preview_phoneRoot__"]')
    const media = phone || el.closest('video,[data-media-slot],[data-qr-code], [data-booking-calendar],[role="grid"]') || /写真|画像の枠|サムネ|時間×卓|スマホ|見え方/.test(name)
    if (!media && hasBorder(c) && r.width>=80 && r.height>=40) {
      for (let p=el.parentElement; p && p!==document.body; p=p.parentElement) {
        const pc=css(p)
        if (pc.overflowY==='visible') continue
        const q=p.getBoundingClientRect()
        // 明示したスクロール欄は、先へ送る操作が実在する場合だけ許す。
        if (['auto','scroll'].includes(pc.overflowY) && p.scrollHeight>p.clientHeight) break
        if (r.bottom>q.bottom+2 && r.top<q.bottom-8) add('boxclip',el,{excess:Math.ceil(r.bottom-q.bottom)},'',p)
        break
      }
    }
  }
  // 横に並ぶカードの高さと下端の操作の位置が1pxもずれない。
  // 対象は高さをそろえる段（data-card-height="equal"）と、印の無い段で同じ幅の列に並ぶカード（カードの格子）。
  // 幅の違う本文と横の欄、data-card-height="natural" の段は対象外。
  const groups = new Set([...root.querySelectorAll('[data-design-part="card"]')].map(card => card.parentElement).filter(Boolean))
  for (const group of groups) {
    if (group.dataset.cardHeight === 'natural') continue
    const rows = new Map()
    for (const card of [...group.children].filter(el => el.matches('[data-design-part="card"]') && visible(el))) {
      const top = Math.round(card.getBoundingClientRect().top)
      rows.set(top, [...rows.get(top) ?? [], card])
    }
    const sameWidths = row => { const w = row.map(card => card.getBoundingClientRect().width); const max = Math.max(...w); return max > 0 && (max - Math.min(...w)) / max <= 0.1 }
    for (const row of [...rows.values()].filter(row => row.length > 1 && (group.dataset.cardHeight === 'equal' || sameWidths(row)))) {
      const heights = row.map(card => card.getBoundingClientRect().height)
      const bottoms = row.map(card => card.querySelector(':scope > [data-card-actions]')).filter(Boolean).map(el => el.getBoundingClientRect().bottom)
      const spread = values => values.length > 1 ? Math.max(...values) - Math.min(...values) : 0
      if (spread(heights) > 1 || spread(bottoms) > 1) add('cardrow', row[0], { height: Math.ceil(spread(heights)), actions: Math.ceil(spread(bottoms)) }, '', row[row.length - 1])
    }
  }
  // 列に入らない文字があるのに、同じ行で80px以上を余らせない。
  for (const table of root.querySelectorAll('table,[role="table"]')) {
    const rows = [...table.querySelectorAll('tr,[role="row"]')].filter(visible)
    const head = rows.find(row => row.querySelector('th,[role="columnheader"]'))
    const spareInCells = cells => cells.map(cell => {
          const box = cell.getBoundingClientRect(), c = css(cell)
          const content = [...cell.childNodes].flatMap(node => {
            if (node.nodeType === 3 && node.textContent.trim()) { const range = document.createRange(); range.selectNodeContents(node); return [range.getBoundingClientRect()] }
            if (node.nodeType !== 1) return []
            const range = document.createRange(); range.selectNodeContents(node)
            return [...range.getClientRects(), ...node.querySelectorAll('button,input,svg,img')].map(el => el.getBoundingClientRect ? el.getBoundingClientRect() : el)
          }).filter(rect => rect.width > 0)
          const used = content.length ? Math.min(box.width, Math.max(...content.map(rect => rect.right)) - box.left) : 0
          return Math.max(0, box.width - used - (parseFloat(c.paddingRight) || 0) - (parseFloat(c.paddingLeft) || 0))
        })

    // 見出しや別の行が必要とする幅は空きに数えず、列全体で回せる余りだけを数える。
    const spareRows = rows.map(row => spareInCells([...row.children].filter(visible)))
    for (const row of rows.filter(row => row !== head)) {
      const cells = [...row.children].filter(visible)
      const clipped = cells.flatMap(cell => [cell, ...cell.querySelectorAll('*')]).filter(el => {
        const c = css(el)
        return c.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()
      })
      if (clipped.length) {
        const spare = cells.reduce((sum, _, index) => sum + Math.min(...spareRows.filter(widths => widths.length === cells.length).map(widths => widths[index])), 0)
        if (spare >= 80) add('table-unused-space', clipped[0], { spare: Math.floor(spare) }, clipped[0].textContent)
      }
      if (!head || cells.length !== head.children.length) continue
      for (const [index, header] of [...head.children].entries()) {
        const match = header.textContent.match(/（([^）]+)）/)
        if (!match) continue
        const terms = match[1].split('・')
        const text = cells[index]?.querySelector('[data-list-name-description]')?.textContent.trim() ?? ''
        const matches = term => term === '質問の数' ? /質問\s*\d+/.test(text) : term === '大きさ' ? /^(大|小)(?:\s|・|$)/.test(text) : term === 'ボタン' ? /\d+\s*(?:ボタン|面)/.test(text) : null
        const missing = terms.filter(term => matches(term) === false)
        if (cells[index]?.textContent.trim() && missing.length) add('table-missing-detail', cells[index], { missing }, header.textContent)
      }
    }
  }
  for (const button of root.querySelectorAll('button')) {
    if (visible(button) && button.textContent.trim() === '詳細' && button.querySelector('.lucide-log-in')) add('action-icon', button, {}, '詳細')
  }
  // 14px 未満の UI 文字を太さ 400 で描かない。
  // お客さまのスマホの見え方（LINE の見本）は LINE と同じ太さなので数えない。
  // V8 の画面（<html data-theme="v8">）だけを見る。アプリの CSS の無い素の見本はブラウザ既定の太さなので数えない。
  for (const el of document.documentElement.dataset.theme === 'v8' ? surfaces.filter(visible) : []) {
    if (el.closest('svg,[data-line-preview-part],[class*="line-preview_phoneRoot__"],[class*="liff-phone-frame_"]')) continue
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()
    if (!text) continue
    const c = css(el), size = parseFloat(c.fontSize), weight = Number(c.fontWeight)
    if (size < 14 && weight < 500) add('thintext', el, { size, weight }, text)
  }
  return findings
}
