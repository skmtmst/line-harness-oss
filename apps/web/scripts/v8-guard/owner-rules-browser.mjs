/** B-199〜B-218。固定Penのdetect.cjsと同じ種類を、描画済みの実装で測る。 */
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
  const descendants = el => [...el.querySelectorAll('*')].filter(visible)
  const textLeaves = el => descendants(el).filter(d => d.childElementCount === 0 && d.textContent.trim() && !d.closest('svg,script,style'))
  // Penの枠は四辺の線。節の上の区切り線だけは箱ではない。
  const hasBorder = c => ['Top','Right','Bottom','Left'].every(side => c[`border${side}Style`] !== 'none' && parseFloat(c[`border${side}Width`]) > 0) || c.boxShadow !== 'none'
  const tinted = c => !['rgba(0, 0, 0, 0)','rgb(255, 255, 255)'].includes(c.backgroundColor)
  const rowSelector = 'tbody > tr, [data-shared-part="list-row"], [role="row"]:not(:has([role="columnheader"])), [data-pencil-name^="行"], [data-pencil-name*="表の行"]'
  const headSelector = 'thead > tr, [data-shared-part="list-head"]'
  const tableSelector = '[data-shared-part="list-table"], table, [role="table"]'
  // カレンダーの週・日セルは表の一覧の行ではない（ALLOW: 時間×卓の格子）。
  const listVisible = el => visible(el) && !el.closest('[role="grid"],[data-booking-calendar]')
  const rows = [...new Set(root.querySelectorAll(rowSelector))].filter(listVisible)
  const nameOf = row => row.querySelector('[data-list-name], [data-row-link], [data-list-name-cell]') || textLeaves(row).find(d => +css(d).fontWeight >= 600 && !d.closest('[data-design-node="xRvDB"],[data-status-pill],[role="button"],button'))
  const texts = [], checkedShort = new Set()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const n = walker.currentNode, el = n.parentElement, text = n.textContent.trim()
    if (!text || !visible(el) || el.closest('svg,script,style,nav,[data-line-preview-part="talk"],[data-template-region="folders"]')) continue
    const range = document.createRange(); range.selectNodeContents(n)
    const bb = range.getBoundingClientRect(), c = css(el)
    texts.push({el,text,bb})
    let trunc = el
    while (trunc && trunc !== root && css(trunc).textOverflow !== 'ellipsis') trunc = trunc.parentElement
    if (trunc && !checkedShort.has(trunc) && css(trunc).textOverflow === 'ellipsis' && (trunc.scrollWidth > trunc.clientWidth + 1 || /…$/.test(trunc.textContent.trim()))) {
      checkedShort.add(trunc)
      // Reactがラベルと値を別のtext nodeにしても、1つの表示文字列として測る。
      const whole = document.createRange(); whole.selectNodeContents(trunc)
      const width = Math.min(whole.getBoundingClientRect().width, trunc.clientWidth), fullText = trunc.textContent.trim()
      if (width < 56 && !/^[…·]+$/.test(fullText)) add('short',trunc,{deficit:Math.ceil(56-width)},fullText)
    }
    if (['rgb(37, 99, 235)','rgb(29, 78, 216)'].includes(c.color)) {
      let pill = false
      for (let p = el, i = 0; p && i < 4; p = p.parentElement,i++) if (tinted(css(p))) { pill = true; break }
      if (!pill) add('blue',el,{count:1},text)
    }
  }
  // 同じ列の主操作・メニュー・状態。幅とxを別々に見張る。
  const groups = new Map()
  for (const row of rows) {
    const parent = row.parentElement
    if (!groups.has(parent)) groups.set(parent,[])
    groups.get(parent).push(row)
  }
  for (const group of groups.values()) {
    if (group.length < 3) continue
    const parts = new Map()
    for (const [i,row] of group.entries()) {
      const rr = row.getBoundingClientRect()
      if (rr.width < 200) continue
      const used = new Set()
      for (const el of descendants(row)) {
        const name = el.getAttribute('data-pencil-name') || ''
        let kind = el.matches('[data-row-menu],button[aria-haspopup="menu"]') ? 'menu'
          : el.matches('[data-row-quick-action], [data-row-actions] > :is(button,a):not([data-row-menu])') ? 'primary'
          : el.matches('[data-status-pill],[data-design-node="xRvDB"]') ? 'status'
          : /操作|メニュー|ボタン|状態/.test(name) ? name.split('/')[0] : null
        if (!kind || used.has(kind)) continue
        used.add(kind)
        const r = el.getBoundingClientRect()
        if (!parts.has(kind)) parts.set(kind,[])
        parts.get(kind).push({el,i,x:r.left-rr.left,width:r.width})
      }
    }
    for (const [kind,values] of parts) {
      const spread = Math.max(...values.map(v=>v.x))-Math.min(...values.map(v=>v.x))
      const widthSpread = Math.max(...values.map(v=>v.width))-Math.min(...values.map(v=>v.width))
      if (values.length >= 2 && (spread > 4 || kind === 'primary' && widthSpread > 4)) add('align',values[0].el,{spread:Math.ceil(Math.max(spread,kind==='primary'?widthSpread:0))},kind)
      if (kind !== 'status' && values.length >= Math.ceil(group.length*.6) && values.length < group.length) add('missing',values[0].el,{missing:group.length-values.length},kind)
    }
  }
  for (const row of rows) {
    const r = row.getBoundingClientRect(), leaves = textLeaves(row)
    if (r.height >= 40 && leaves.length) {
      const used = Math.max(...leaves.map(d=>d.getBoundingClientRect().bottom))-Math.min(...leaves.map(d=>d.getBoundingClientRect().top))
      if (used > 0 && r.height-used > 48) add('tallrow',row,{excess:Math.ceil(r.height-used-48)})
    }
    const table = row.closest(tableSelector)
    if (tinted(css(row)) && table) {
      const t = table.getBoundingClientRect(), left = r.left-t.left, right = t.right-r.right
      if (left > 3 || right > 3) add('rowbg',row,{left:Math.max(0,Math.ceil(left)),right:Math.max(0,Math.ceil(right))})
    }
    const name = nameOf(row)
    if (name) {
      const elements = [name,...descendants(name)].filter(d=>d.textContent.trim() && !d.closest('button,[data-status-pill],[data-design-node="xRvDB"]'))
      // 固定Penと同じく、色付きの状態の札を名前と取り違えない。
      const colored = elements.find(d => !tinted(css(d)) && +css(d).fontWeight >= 600 && ['rgb(8, 122, 62)','rgb(3, 135, 58)','rgb(37, 99, 235)'].includes(css(d).color))
      if (colored) add('greenname',colored,{count:1},colored.textContent.trim())
      const truncated = elements.find(d => css(d).textOverflow === 'ellipsis' && d.scrollWidth > d.clientWidth+1 || /…$/.test(d.textContent.trim()) && d.childElementCount === 0)
      if (truncated) {
        const text = truncated.textContent.trim(), range = document.createRange()
        range.selectNodeContents(truncated)
        const average = range.getBoundingClientRect().width / Math.max(1,text.length)
        const width = truncated.getBoundingClientRect().width
        const chars = /…$/.test(text) ? text.length-1 : Math.floor(width/Math.max(1,average))
        if (chars < 12) add('shortname',truncated,{deficit:12-chars},text)
      }
    }
  }
  for (const row of [...rows,...root.querySelectorAll(headSelector)].filter(listVisible)) {
    const r = row.getBoundingClientRect()
    if (r.width < 300 || r.height < 28) continue
    const content = descendants(row).filter(d => d.matches('button,input,a,svg') || d.childElementCount===0 && d.textContent.trim())
    if (!content.length) continue
    const right = Math.max(...content.map(d=>d.getBoundingClientRect().right))
    const gap = r.right-right
    if (gap < 12) add('edge',row,{deficit:Math.ceil(12-gap)})
  }
  // 小窓・吹き出し・通知はmainの外へ描かれる。面の検査はその口にも届かせる。
  const portals = [...document.querySelectorAll('[role="dialog"],[role="tooltip"],[aria-label="知らせ"]')]
  const surfaces = [...new Set([root,...root.querySelectorAll('*'),...portals.flatMap(el => [el,...el.querySelectorAll('*')])])]
  for (const el of surfaces.filter(visible)) {
    const c = css(el), r = el.getBoundingClientRect(), name = el.getAttribute('data-pencil-name') || ''
    // 時間×卓、スマホの見え方、画像そのものは意図した端接触。ALLOW.tsvと同じ対象限定。
    const media = el.closest('[data-line-preview-part="talk"],video,[data-media-slot],[data-qr-code], [data-booking-calendar],[role="grid"]') || /写真|画像の枠|サムネ|時間×卓|スマホ|見え方/.test(name)
    // 主なページの器はスクロールする。内側の箱だけをtightで測る（ALLOWのパネルと同じ）。
    if (el !== root && !media && r.height >= 80 && r.width >= 120 && (hasBorder(c) || c.outlineStyle!=='none' || tinted(c) && c.borderRadius!=='0px') && !el.matches(tableSelector) && !el.querySelector('table,[role="table"]')) {
      const leaves = textLeaves(el)
      if (leaves.length) {
        const top = Math.min(...leaves.map(d=>d.getBoundingClientRect().top))-r.top
        const bottom = r.bottom-Math.max(...leaves.map(d=>d.getBoundingClientRect().bottom))
        if (top < 8 || bottom < 8) add('tight',el,{topDeficit:Math.max(0,Math.ceil(8-top)),bottomDeficit:Math.max(0,Math.ceil(8-bottom))})
      }
    }
    const rgb = c.backgroundColor.match(/[\d.]+/g)
    if (rgb?.length>=3 && (rgb.length<4 || +rgb[3]>=.5) && Math.max(...rgb.slice(0,3).map(Number))<=70 && r.width>=24 && r.height>=16 && el.textContent.trim()) {
      // 白地を要求する面を読む。動画と写真上の文字、端末の枠は固定Penでも除外。
      const exempt = el.closest('video,[data-line-preview-part],[data-avatar],[data-video-player],[data-photo-caption]') || /スマホ|島|動画|再生|プレイヤー|写真|アバター|顔|phone|video/i.test(name)
      if (!exempt) add('dark',el,{count:1},el.textContent.trim().slice(0,20))
    }
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
  for (const bar of [...root.querySelectorAll('[data-shared-part="sticky-bar"],[data-pencil-name*="下の帯"]')].filter(visible)) {
    const b=bar.getBoundingClientRect(), parent=bar.parentElement
    if (!parent || b.height<40 || root.closest('[data-liff]')) continue
    const ends=textLeaves(parent).filter(d=>!bar.contains(d)).map(d=>d.getBoundingClientRect().bottom).filter(bottom=>bottom<=b.top+1)
    if (ends.length) { const gap=b.top-Math.max(...ends); if(gap>=96) add('footgap',bar,{excess:Math.ceil(gap-95)}) }
  }
  for (const table of [...root.querySelectorAll('[data-shared-part="list-table"]')].filter(visible)) {
    const r=table.getBoundingClientRect(), parent=table.parentElement
    if (!parent || r.width<400) continue
    const siblings=[...parent.children].filter(d=>d!==table && visible(d) && d.matches('[data-list-toolbar],[data-template-region="toolbar"],[data-shared-part="notice"]'))
    for (const sib of siblings) {
      const q=sib.getBoundingClientRect(), left=q.left-r.left, right=r.right-q.right
      if (left>4 || right>4) add('inset',table,{left:Math.max(0,Math.ceil(left)),right:Math.max(0,Math.ceil(right))},'',sib)
    }
  }
  return findings
}
