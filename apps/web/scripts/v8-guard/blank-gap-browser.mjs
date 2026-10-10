// ブラウザの中で動く「大きな空白」探し（読むだけ。調べる間だけ style を一時的に当てて戻す）。
// 戻り値：{ findings:[…], bands:[…], meta:{…} }
// opts: { th: 48, hth: 72, width }
export default function scanBlankGap(opts = {}) {
  const TH = opts.th ?? 48
  const HTH = opts.hth ?? 72
  const out = { findings: [], bands: [], meta: {} }

  // ---------- 小道具
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgba = (c) => {
    if (!c || c === 'transparent') return null
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
    // color-mix の color(srgb …) や16進数も読む。fillStyleを再帰すると同じ色が返り続ける。
    try {
      cv.clearRect(0, 0, 1, 1)
      cv.fillStyle = 'transparent'
      cv.fillStyle = c
      cv.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data
      return { r, g, b, a: a / 255 }
    } catch { return null }
  }
  const alpha = (c) => { const x = rgba(c); return x ? x.a : 0 }
  const same = (a, b) => a && b && Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 6
  const csCache = new Map()
  const CS = (el) => { let s = csCache.get(el); if (!s) { s = getComputedStyle(el); csCache.set(el, s) } return s }
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

  const reactNames = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
    if (!key) return ''
    const names = []
    for (let f = el[key]; f && names.length < 4; f = f.return) {
      const t = f.type
      const n = typeof t === 'function' ? (t.displayName || t.name) : (t && typeof t === 'object' ? (t.displayName || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name))) : null)
      if (n && /^[A-Z]/.test(n) && !/^(Fragment|Suspense|Provider|Context|Consumer|ForwardRef|Memo|Slot|Primitive|Presence|Portal|DismissableLayer|FocusScope|Link|LinkComponent|ErrorBoundary|InnerLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|OuterLayoutRouter|LoadingBoundary|HTTPAccessFallbackBoundary|RedirectBoundary|InnerScrollAndFocusHandler|Router|AppRouter)/.test(n) && !names.includes(n)) names.push(n)
    }
    return names.join(' < ')
  }
  const clsOf = (p) => typeof p.className === 'string' ? p.className.trim().split(/\s+/).filter((c) => c && !/^(v7|v8):?/.test(c)).slice(0, 3).join('.') : ''
  const selectorOf = (el, depth = opts.selectorDepth ?? 3) => {
    const parts = []
    for (let p = el; p && p !== document.body && parts.length < depth; p = p.parentElement) {
      const c = clsOf(p)
      const siblings = p.parentElement ? [...p.parentElement.children].filter(s => s.tagName === p.tagName) : [p]
      parts.unshift(p.tagName.toLowerCase() + (c ? '.' + c : '') + (opts.exactSelectors ? ':nth-of-type(' + (siblings.indexOf(p) + 1) + ')' : ''))
    }
    return parts.join(' > ').slice(0, opts.selectorLimit ?? 260)
  }
  const textOf = (el) => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)

  // CSS の規則（どの宣言が値を決めたか）
  let RULES = null
  const flatRules = () => {
    if (RULES) return RULES
    RULES = []
    const walk = (list, media) => { for (const r of list) { if (r.selectorText && r.style) RULES.push({ r, media }); else if (r.cssRules) walk(r.cssRules, r.conditionText || r.name || media) } }
    for (const sh of document.styleSheets) { try { walk(sh.cssRules, null) } catch {} }
    return RULES
  }
  const declOf = (el, prop) => {
    const hits = []
    if (el.style && el.style.getPropertyValue(prop)) hits.push({ sel: '(style 属性)', val: el.style.getPropertyValue(prop) })
    for (const { r, media } of flatRules()) {
      const v = r.style.getPropertyValue(prop)
      if (!v) continue
      let ok = false
      try { ok = el.matches(r.selectorText) } catch {}
      if (ok) hits.push({ sel: r.selectorText.slice(0, 200), val: v.slice(0, 120), media: media ? String(media).slice(0, 60) : undefined })
    }
    return hits.slice(-3) // 後に書いた物ほど勝つことが多いので後ろを残す
  }

  // ---------- 調べる場所（白い板＝main と、開いている窓）
  const roots = []
  const main = document.querySelector('main')
  if (main) roots.push({ el: main, kind: 'main' })
  for (const d of document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true]')) {
    const r = d.getBoundingClientRect()
    if (r.width > 80 && r.height > 80 && CS(d).visibility !== 'hidden') roots.push({ el: d, kind: 'dialog' })
  }

  const visCache = new Map()
  const visible = (el) => {
    if (visCache.has(el)) return visCache.get(el)
    let v = true
    const s = CS(el)
    // ページ内のタブは見える中身。段が増えても、その場所を空白と数えない。
    if ((el.matches('nav') && !el.querySelector('[role="tablist"]')) || el.matches('[data-template-region="folders"],[data-template-region="collapsed-folders"],[data-line-preview-part="talk"]') || /フォルダの列|左メニュー/.test(el.getAttribute('data-pencil-name') || '') || /(?:^|[ _-])(?:bubbleBody|bubbleText|bubbleIn|bubbleOut|messageBubble|bubble)(?:[_ -]|$)/i.test(typeof el.className === 'string' ? el.className : '')) v = false
    else if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) < 0.03) v = false
    else if (el.parentElement && el.parentElement !== document.documentElement) v = visible(el.parentElement)
    visCache.set(el, v)
    return v
  }

  const modal = roots.some((r) => r.kind === 'dialog' && (r.el.getAttribute('aria-modal') === 'true' || r.el.closest('[aria-modal=true]')))
  out.meta.modalOpen = modal
  for (const root of roots) if (!(modal && root.kind === 'main')) analyzeRoot(root)

  function analyzeRoot(root) {
    const R = root.el
    const rr = R.getBoundingClientRect()
    const scrolls = R.scrollHeight > R.clientHeight + 2 && /(auto|scroll)/.test(CS(R).overflowY)
    const offY = scrolls ? R.scrollTop - rr.top : 0
    const offX = -rr.left
    // 座標：root の中身の左上が 0
    const toLocal = (r) => ({ x: r.left + offX, y: r.top + offY + (scrolls ? 0 : -rr.top), w: r.width, h: r.height })
    const rootBox = { x: 0, y: 0, w: rr.width, h: scrolls ? R.scrollHeight : rr.height }

    // 見切り：途中の overflow で切られる部分を外す
    const clipCache = new Map()
    const clipOf = (el) => {
      if (!el || el === R) return null
      if (clipCache.has(el)) return clipCache.get(el)
      let c = clipOf(el.parentElement)
      const s = CS(el)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const b = toLocal(el.getBoundingClientRect())
        c = c ? inter(c, b) : b
      }
      clipCache.set(el, c)
      return c
    }
    const inter = (a, b) => { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h); return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) } }

    // 地の色（後ろに見えている色）
    const backCache = new Map()
    const backdrop = (el) => {
      if (!el || el === document.documentElement) return { r: 255, g: 255, b: 255, a: 1 }
      if (backCache.has(el)) return backCache.get(el)
      const c = rgba(CS(el).backgroundColor)
      const v = c && c.a > 0.5 ? c : backdrop(el.parentElement)
      backCache.set(el, v)
      return v
    }
    // 箱として見えるか（地・影・2辺以上の枠）
    const surfCache = new Map()
    const surfaceInfo = (el) => {
      if (surfCache.has(el)) return surfCache.get(el)
      const s = CS(el)
      let why = el.getAttribute('data-blank-ok')?.trim() ? 'declared' : null
      const bg = rgba(s.backgroundColor)
      if (bg && bg.a >= 0.1 && !same(bg, backdrop(el.parentElement))) why = 'bg'
      else if (s.backgroundImage && s.backgroundImage !== 'none') why = 'bgimg'
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((d) => px(s['border' + d + 'Width']) > 0 && s['border' + d + 'Style'] !== 'none' && alpha(s['border' + d + 'Color']) > 0.03)
      if (!why && sides.length >= 2) why = 'border'
      const sh = s.boxShadow
      const outer = sh && sh !== 'none' && sh.split(/,(?![^(]*\))/).some((p) => !/inset/.test(p) && !/^\s*rgba?\([^)]*,\s*0\)/.test(p))
      if (!why && outer) why = 'shadow'
      // 内側の影で四方に描く線（0 0 0 1px inset）は枠と同じ
      if (!why && sh && sh !== 'none') {
        for (const part of sh.split(/,(?![^(]*\))/)) {
          if (!/inset/.test(part)) continue
          const col = (part.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i) || [''])[0]
          if (col && alpha(col) < 0.03) continue
          const nums = part.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+px/g) || []
          const [x, y, , spread] = nums.map(parseFloat)
          if (x === 0 && y === 0 && spread > 0) { why = 'inset-ring'; break }
        }
      }
      if (!why && s.outlineStyle !== 'none' && px(s.outlineWidth) > 0 && alpha(s.outlineColor) > 0.03) why = 'outline'
      const res = { why, sides }
      surfCache.set(el, res)
      return res
    }

    // ---------- 見える物（items）を集める
    const items = [] // {x,y,w,h, el, kind, vline, hline, owner}
    const surfaces = new Set([R])
    const isSkippedPos = (el) => {
      for (let p = el; p && p !== R; p = p.parentElement) {
        const s = CS(p)
        if (s.position === 'fixed') return true
        if (s.position === 'sticky' && s.bottom !== 'auto' && s.top === 'auto') return true
      }
      return false
    }
    const pushRect = (el, r, kind, get) => {
      if (r.width < 1 || r.height < 1) return
      let b = toLocal(r)
      const c = clipOf(el)
      if (c) { b = inter(b, c); if (b.w < 1 || b.h < 1) return }
      items.push({ ...b, el, kind, vline: kind === 'line' && b.w <= 3, hline: kind === 'line' && b.h <= 3, get: get || (() => el.getBoundingClientRect()) })
    }
    const all = R.querySelectorAll('*')
    for (const el of all) {
      if (root.kind === 'main' && el.closest('[role=dialog],[aria-modal=true]')) continue
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      if (isSkippedPos(el)) continue
      const tag = el.tagName
      if (/^(IMG|SVG|CANVAS|VIDEO|IFRAME|INPUT|TEXTAREA|SELECT|PROGRESS|HR|svg)$/.test(tag) || el.getAttribute('role') === 'img') {
        if (tag === 'INPUT' && el.type === 'hidden') continue
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
        if (el.tagName.toLowerCase() === 'svg' && el.parentElement && el.parentElement.closest('svg')) continue
        pushRect(el, r, 'replaced')
      }
      const si = surfaceInfo(el)
      if (si.why) { surfaces.add(el); pushRect(el, r, 'surface') }
      else if (si.sides.length === 1) {
        const s = CS(el); const d = si.sides[0]; const w = px(s['border' + d + 'Width'])
        const lr = d === 'Top' ? { left: r.left, top: r.top, width: r.width, height: w } : d === 'Bottom' ? { left: r.left, top: r.bottom - w, width: r.width, height: w } : d === 'Left' ? { left: r.left, top: r.top, width: w, height: r.height } : { left: r.right - w, top: r.top, width: w, height: r.height }
        pushRect(el, lr, 'line', () => { const q = el.getBoundingClientRect(); return d === 'Top' ? { left: q.left, top: q.top, width: q.width, height: w } : d === 'Bottom' ? { left: q.left, top: q.bottom - w, width: q.width, height: w } : q })
      }
      // 内側の影で描く線（inset 0 -1px …）
      const sh = CS(el).boxShadow
      if (!si.why && sh && /inset/.test(sh) && !/rgba?\([^)]*,\s*0\)/.test(sh)) {
        const m = sh.match(/inset\s+(-?\d+)px\s+(-?\d+)px/) || sh.match(/(-?\d+)px\s+(-?\d+)px[^,]*inset/)
        if (m) {
          const dx = +m[1], dy = +m[2]
          if (dy) pushRect(el, { left: r.left, top: dy < 0 ? r.bottom - Math.abs(dy) : r.top, width: r.width, height: Math.abs(dy) }, 'line')
          if (dx) pushRect(el, { left: dx < 0 ? r.right - Math.abs(dx) : r.left, top: r.top, width: Math.abs(dx), height: r.height }, 'line')
        }
      }
    }
    // 文字
    const tw = document.createTreeWalker(R, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    while (tw.nextNode()) {
      const n = tw.currentNode
      if (!n.nodeValue || !n.nodeValue.trim()) continue
      const pe = n.parentElement
      if (!pe || !visible(pe) || pe.closest('script,style,noscript')) continue
      if (root.kind === 'main' && pe.closest('[role=dialog],[aria-modal=true]')) continue
      if (alpha(CS(pe).color) < 0.05) continue
      if (isSkippedPos(pe)) continue
      // sr-only
      const pr = pe.getBoundingClientRect()
      if (pr.width <= 2 && pr.height <= 2) continue
      range.selectNodeContents(n)
      const getN = () => { const rg = document.createRange(); rg.selectNodeContents(n); return rg.getBoundingClientRect() }
      for (const r of range.getClientRects()) pushRect(pe, r, 'text', getN)
    }

    // 持ち主（いちばん近い見える箱）
    const ownerCache = new Map()
    const ownerOf = (el, strict) => {
      let p = strict ? el.parentElement : el
      while (p && p !== R && !surfaces.has(p)) p = p.parentElement
      return p && surfaces.has(p) ? p : R
    }
    for (const it of items) it.owner = it.kind === 'surface' ? ownerOf(it.el, true) : ownerOf(it.el, false)

    const groups = new Map()
    for (const it of items) { if (!groups.has(it.owner)) groups.set(it.owner, []); groups.get(it.owner).push(it) }

    const rootIsStretched = (() => {
      // 板の中身が板より低い（板は画面の高さまで伸びている）か
      let maxB = 0
      for (const it of items) maxB = Math.max(maxB, it.y + it.h)
      return { contentBottom: maxB }
    })()

    // ---------- 縦の空白：箱ごと
    const boxLocal = (el) => el === R ? rootBox : toLocal(el.getBoundingClientRect())
    for (const C of surfaces) {
      const its = (groups.get(C) || []).filter((i) => !i.vline)
      const cb = boxLocal(C)
      if (cb.h < TH + 16 || cb.w < 60) continue
      const cl = clipOf(C)
      const s = CS(C)
      const innerTop = cb.y + px(s.borderTopWidth), innerBot = cb.y + cb.h - px(s.borderBottomWidth)
      const padT = px(s.paddingTop), padB = px(s.paddingBottom)
      // 見えている範囲（切られている箱は見える所だけ）
      const visTop = cl ? Math.max(innerTop, cl.y) : innerTop
      const visBot = cl ? Math.min(innerBot, cl.y + cl.h) : innerBot
      if (visBot - visTop < TH) continue
      const iv = its.map((i) => [Math.max(i.y, visTop), Math.min(i.y + i.h, visBot), i]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
      const merged = []
      for (const [a, b, it] of iv) {
        const last = merged[merged.length - 1]
        if (last && a <= last.b + 0.5) { if (b > last.b) { last.b = b; last.lastIt = it } }
        else merged.push({ a, b, firstIt: it, lastIt: it })
      }
      const isRoot = C === R
      const gaps = []
      if (!merged.length) {
        // 中身の無い大きな箱
        if (!isRoot && !(opts.skipPanelBottom && cb.h >= 200 && cb.w >= 200) && visBot - visTop - padT - padB >= TH) gaps.push({ where: 'empty-box', y1: visTop, y2: visBot, blank: visBot - visTop, excess: visBot - visTop - Math.min(padT, 24) - Math.min(padB, 24) })
      } else {
        const first = merged[0], last = merged[merged.length - 1]
        const top = first.a - visTop
        if (top - Math.min(padT, 24) >= TH && !(isRoot && root.kind === 'main')) gaps.push({ where: 'top', y1: visTop, y2: first.a, blank: top, excess: top - Math.min(padT, 24), next: first.firstIt })
        for (let k = 1; k < merged.length; k++) {
          const g = merged[k].a - merged[k - 1].b
          if (g >= TH) gaps.push({ where: 'between', y1: merged[k - 1].b, y2: merged[k].a, blank: g, excess: g, prev: merged[k - 1].lastIt, next: merged[k].firstIt })
        }
        const bot = visBot - last.b
        if (!opts.skipPanelBottom && bot - Math.min(padB, 24) >= TH) gaps.push({ where: isRoot ? 'page-bottom' : 'bottom', y1: last.b, y2: visBot, blank: bot, excess: bot - Math.min(padB, 24), prev: last.lastIt })
      }
      for (const g of gaps) {
        const f = describeGap(C, cb, g, its)
        f.root = root.kind
        out.findings.push(f)
      }
    }

    // ---------- 横の空白（板だけ）
    if (root.kind === 'main') {
      const s = CS(R)
      const innerR = rootBox.w - px(s.paddingRight) - px(s.borderRightWidth)
      // 板の直下の白い板（app-shell の中の板）があればそちらの右端
      const strip = 40
      const H = Math.ceil(rootBox.h / strip)
      const maxR = new Array(H).fill(-1)
      const leaf = items.filter((i) => !(i.kind === 'surface' && i.w >= rootBox.w * 0.95 && i.h >= rootBox.h * 0.6))
      for (const it of leaf) {
        for (let k = Math.max(0, Math.floor(it.y / strip)); k <= Math.min(H - 1, Math.floor((it.y + it.h - 0.01) / strip)); k++) maxR[k] = Math.max(maxR[k], it.x + it.w)
      }
      // 右の余白のいちばん内側（板の中で一番右まで描いている物）
      let boardRight = 0
      for (const it of items) if (it.x + it.w <= innerR + 1) boardRight = Math.max(boardRight, it.x + it.w)
      const ref = Math.min(innerR, boardRight)
      // 右まで届く物が最後にある所より下は「ページの下の余り」なので見ない
      let wideBottom = 0
      for (const it of leaf) if (it.x + it.w >= ref - HTH) wideBottom = Math.max(wideBottom, it.y + it.h)
      const kMax = Math.min(H, Math.floor(wideBottom / strip))
      let run = null
      const runs = []
      for (let k = 0; k <= kMax; k++) {
        const empty = k < kMax && maxR[k] >= 0 && ref - maxR[k] >= HTH
        if (empty) { if (!run) run = { k0: k, k1: k, minGap: ref - maxR[k], maxRight: maxR[k] }; else { run.k1 = k; run.minGap = Math.min(run.minGap, ref - maxR[k]); run.maxRight = Math.max(run.maxRight, maxR[k]) } }
        else if (run) { runs.push(run); run = null }
      }
      for (const r of runs) {
        const y1 = r.k0 * strip, y2 = (r.k1 + 1) * strip
        if (y2 - y1 < 160) continue
        // 右端を決めている要素
        const inStrip = leaf.filter((i) => i.y < y2 && i.y + i.h > y1)
        let edge = inStrip.sort((a, b) => b.x + b.w - (a.x + a.w))[0]
        const f = { kind: 'horizontal', where: 'right', root: 'main', y1, y2, x1: r.maxRight, x2: ref, blank: Math.round(r.minGap), excess: Math.max(0, Math.round(r.minGap - 24)), box: { x: 0, y: y1, w: rootBox.w, h: y2 - y1 } }
        if (edge) {
          f.edge = { sel: selectorOf(edge.el), comp: reactNames(edge.el), text: textOf(edge.el).slice(0, 30) }
          f.causes = opts.diagnose ? testHorizontal(edge.el, r.maxRight, y1, y2) : []
        }
        if (f.y1 < 320 && /head|heading|tabs/i.test(f.edge?.sel ?? '')) f.excluded = 'heading'
        // 左の入力が続いても、右の説明欄の終わりより下はその欄の下の余り。
        for (let el = edge?.el; el && el !== R; el = el.parentElement) {
          const parent = el.parentElement
          if (!parent || !/(flex|grid)/.test(CS(parent).display) || CS(parent).flexDirection === 'column') continue
          const right = [...parent.children].filter(sib => sib !== el && visible(sib) && toLocal(sib.getBoundingClientRect()).x >= f.x1)
          if (right.length && right.every(sib => { const b = toLocal(sib.getBoundingClientRect()); return b.y + b.h <= y1 + 1 })) f.excluded ??= 'column-bottom'
        }
        const allowed = edge?.el.closest('[data-blank-ok]')
        if (allowed?.getAttribute('data-blank-ok')?.trim()) f.excluded = 'declared: ' + allowed.getAttribute('data-blank-ok')
        out.findings.push(f)
      }
    }

    // ---------- 数の帯（KpiCard の並び）を数える
    if (root.kind === 'main') {
      const kp = [...R.querySelectorAll('[data-kpi-strip] > [data-kpi-presentation]')].filter(e => !e.hasAttribute('data-kpi-strip') && visible(e) && e.getBoundingClientRect().height > 30)
      const parents = new Map()
      for (const e of kp) { const p = e.parentElement; if (!parents.has(p)) parents.set(p, []); parents.get(p).push(e) }
      for (const [p, cs] of parents) {
        if (cs.length < 2) continue
        const b = toLocal(p.getBoundingClientRect())
        const hs = cs.map((c) => Math.round(c.getBoundingClientRect().height))
        // 中身の高さ（文字の下端）
        const contentH = cs.map((c) => { let mb = 0; const cr = c.getBoundingClientRect(); for (const it of items) if (c.contains(it.el) && it.el !== c && it.kind !== 'surface') mb = Math.max(mb, it.y + it.h - toLocal(cr).y); return Math.round(mb) })
        out.bands.push({ sel: selectorOf(p), comp: reactNames(cs[0]), y: Math.round(b.y), h: Math.round(b.h), n: cs.length, cardH: hs, contentH, minH: CS(cs[0]).minHeight, excluded: p.closest('[data-blank-ok]')?.getAttribute('data-blank-ok')?.trim() || null })
      }
    }

    function describeGap(C, cb, g, its) {
      const f = { kind: g.where === 'empty-box' ? 'empty-box' : (g.where === 'between' || g.where === 'top' ? 'vertical' : 'box-bottom'), where: g.where, y1: Math.round(g.y1), y2: Math.round(g.y2), blank: Math.round(g.blank), excess: Math.max(0, Math.round(g.blank - 24)) }
      f.container = { sel: selectorOf(C), comp: reactNames(C), isRoot: C === R, h: Math.round(cb.h), w: Math.round(cb.w), minH: CS(C).minHeight, height: CS(C).height, display: CS(C).display, text: textOf(C).slice(0, 40) }
      f.box = { x: Math.round(cb.x), y: Math.round(g.y1 - 60), w: Math.round(cb.w), h: Math.round(g.y2 - g.y1 + 120) }
      if (g.prev) f.prev = { sel: selectorOf(g.prev.el), comp: reactNames(g.prev.el), text: textOf(g.prev.el).slice(0, 30) }
      if (g.next) f.next = { sel: selectorOf(g.next.el), comp: reactNames(g.next.el), text: textOf(g.next.el).slice(0, 30) }
      // 空・読み込み中の表示か
      const t = textOf(C)
      // 除外は見える箱自身と祖先で決める。右欄そのものは見本の内部ではない。
      const allowed = C.closest('[data-blank-ok]')
      if (allowed?.getAttribute('data-blank-ok')?.trim()) f.excluded = 'declared: ' + allowed.getAttribute('data-blank-ok')
      if (g.where === 'page-bottom') f.excluded = 'page-bottom'
      for (let el = C; el && el !== R; el = el.parentElement) {
        const own = clsOf(el) + ' ' + reactNames(el).split(' < ')[0]
        if (/line-preview|phone_|phone__|MenuPreview|video_|player|preview_screen|comments_screen|previewMenu|media-slot/i.test(own)) f.excluded ??= 'preview'
        if (el.matches('input,textarea,select,[contenteditable=true],[role=textbox]')) f.excluded ??= 'field'
        if (el.matches('[data-template-region=heading]') || /heading_|head__/i.test(clsOf(el))) f.excluded ??= 'heading'
      }
      const ps = C.parentElement && CS(C.parentElement)
      if (ps && /flex|grid/.test(ps.display) && C !== R &&
          !/side_|side__|preview_|preview__|rail_|rail__|aside_|aside__/i.test(clsOf(C))) {
        const siblings = [...C.parentElement.children].filter(el => el !== C && visible(el))
        // 同じ役目（同じクラス）のカードだけ。入力側と見本側の高さそろえは除外しない。
        if (siblings.some(el => clsOf(el) === clsOf(C) && surfaceInfo(el).why &&
            Math.abs(el.getBoundingClientRect().height - cb.h) < 3 &&
            Math.abs(el.getBoundingClientRect().top - C.getBoundingClientRect().top) < 3)) f.excluded ??= 'equal-cards'
      }
      f.emptyish = /読み込み中|読み込んで|ありません|まだ[^。]{0,12}ません|見つかりません|^0件|準備中/.test((C === R ? '' : t)) || !!C.querySelector('[aria-busy=true],[class*="skeleton"],[class*="Skeleton"],[class*="list-state"],[class*="listState"]')
      f.causes = opts.diagnose && g.where !== 'page-bottom' ? testVertical(C, g) : []
      return f
    }

    // 空白の大きさを測り直す
    function measureGap(C, g) {
      const cb = boxLocal(C)
      const s = CS(C)
      if (g.where === 'bottom' || g.where === 'page-bottom') {
        const lb = toLocal(g.prev.get())
        const innerBot = cb.y + cb.h - px(getComputedStyle(C).borderBottomWidth)
        return innerBot - (lb.y + lb.h)
      }
      if (g.where === 'top') { const nb = toLocal(g.next.get()); return nb.y - (cb.y + px(getComputedStyle(C).borderTopWidth)) }
      if (g.where === 'between') { const pb = toLocal(g.prev.get()), nb = toLocal(g.next.get()); return nb.y - (pb.y + pb.h) }
      if (g.where === 'empty-box') return cb.h
      return 0
    }
    function tryStyle(el, css, C, g, base) {
      const old = el.getAttribute('style')
      el.setAttribute('style', (old ? old + ';' : '') + css)
      csCache.clear()
      let v = base
      try { v = measureGap(C, g) } catch {}
      if (old === null) el.removeAttribute('style'); else el.setAttribute('style', old)
      csCache.clear()
      return v
    }
    function testVertical(C, g) {
      const causes = []
      let base
      try { base = measureGap(C, g) } catch { return causes }
      // 候補：空白の高さを縦に覆っている要素（深い物から C まで）
      const ya = g.y1 + 1, yb = g.y2 - 1
      const cands = []
      const walkFrom = (el) => { for (let p = el; p && p !== C.parentElement; p = p.parentElement) { if (!cands.includes(p)) cands.push(p); if (p === C) break } }
      // 覆う要素の一番深い物を探す
      let deepest = null
      for (const el of C.querySelectorAll('*')) {
        if (!visible(el)) continue
        const b = toLocal(el.getBoundingClientRect())
        if (b.y <= ya && b.y + b.h >= yb && b.w > 20) { if (!deepest || deepest.contains(el)) deepest = el }
      }
      if (deepest) walkFrom(deepest)
      if (g.prev) walkFrom(g.prev.el)
      if (g.next) walkFrom(g.next.el)
      if (!cands.includes(C)) cands.push(C)
      // 箱の下が空く形は、親（並び・grid の行）が決めていることがある
      if (g.where !== 'between' && g.where !== 'top') { let p = C.parentElement; for (let d = 0; p && p !== R.parentElement && d < 3; d++, p = p.parentElement) if (!cands.includes(p)) cands.push(p) }
      // 空白の中にすっぽり入る見えない要素（空の div・余白の箱）
      const spacers = []
      for (const el of C.querySelectorAll('*')) {
        if (!visible(el) || cands.includes(el)) continue
        const b = toLocal(el.getBoundingClientRect())
        if (b.h >= 24 && b.y >= g.y1 - 1 && b.y + b.h <= g.y2 + 1 && b.w > 20 && !(el.parentElement && spacers.includes(el.parentElement))) spacers.push(el)
      }
      const tests = []
      for (const el of [...cands.slice(0, 14), ...spacers.slice(0, 6)]) {
        const s = getComputedStyle(el)
        const ps = el.parentElement ? getComputedStyle(el.parentElement) : null
        if (px(s.minHeight) > 0) tests.push([el, 'min-height', 'min-height:0px !important', s.minHeight])
        tests.push([el, 'height', 'height:auto !important', s.height])
        if (ps && /flex/.test(ps.display) && px(s.flexGrow) > 0) tests.push([el, 'flex-grow', 'flex-grow:0 !important', s.flexGrow])
        if (ps && /(flex|grid)/.test(ps.display) && /^(normal|stretch|auto)$/.test(s.alignSelf)) tests.push([el, 'align-self', 'align-self:flex-start !important', s.alignSelf + '（親 ' + ps.display + ' ' + (ps.flexDirection || '') + ' align-items:' + ps.alignItems + '）'])
        if (/grid/.test(s.display) && s.gridAutoRows !== 'auto') tests.push([el, 'grid-auto-rows', 'grid-auto-rows:auto !important', s.gridAutoRows.slice(0, 80)])
        if (/(flex|grid)/.test(s.display) && /^(normal|stretch)$/.test(s.alignItems) && s.flexDirection !== 'column' && el !== C) tests.push([el, 'align-items', 'align-items:flex-start !important', s.alignItems])
        if (/grid/.test(s.display) && s.gridTemplateRows !== 'none') tests.push([el, 'grid-template-rows', 'grid-template-rows:none !important;grid-auto-rows:auto !important;align-content:start !important', s.gridTemplateRows.slice(0, 80)])
        if (/(flex|grid)/.test(s.display) && /^(space-between|space-around|space-evenly|center|end|flex-end)$/.test(s.justifyContent) && (s.flexDirection === 'column' || /grid/.test(s.display))) tests.push([el, 'justify-content', 'justify-content:flex-start !important', s.justifyContent])
        if (/(flex|grid)/.test(s.display) && /^(space-between|space-around|space-evenly|center|end|flex-end)$/.test(s.alignContent)) tests.push([el, 'align-content', 'align-content:start !important', s.alignContent])
        if (/(flex)/.test(s.display) && s.flexDirection === 'row' && /^(center|end|flex-end)$/.test(s.alignItems)) tests.push([el, 'align-items', 'align-items:flex-start !important', s.alignItems])
        if (px(s.paddingTop) >= 24) tests.push([el, 'padding-top', 'padding-top:0 !important', s.paddingTop])
        if (px(s.paddingBottom) >= 24) tests.push([el, 'padding-bottom', 'padding-bottom:0 !important', s.paddingBottom])
        if (Math.abs(px(s.marginTop)) >= 24) tests.push([el, 'margin-top', 'margin-top:0 !important', s.marginTop])
        if (Math.abs(px(s.marginBottom)) >= 24) tests.push([el, 'margin-bottom', 'margin-bottom:0 !important', s.marginBottom])
        if (px(s.rowGap) >= 24) tests.push([el, 'row-gap', 'row-gap:0 !important', s.rowGap])
        if (spacers.includes(el)) tests.push([el, 'display', 'display:none !important', '（空の箱）'])
      }
      for (const [el, prop, css, val] of tests.slice(0, 80)) {
        const v = tryStyle(el, css, C, g, base)
        const red = base - v
        if (red >= 16) {
          const c = { sel: selectorOf(el), comp: reactNames(el), prop, val, reduce: Math.round(red), isContainer: el === C, isParent: el.contains(C) && el !== C, decl: declOf(el, prop === 'display' ? 'height' : prop) }
          // 並びの中で隣が高いから伸びているか（高さそろえ）
          if (/align/.test(prop)) {
            const row = el.contains(C) && el !== C ? el : C.parentElement
            const kids = row ? [...row.children].filter((k) => visible(k) && !k.contains(C) && k !== C) : []
            const myH = C.getBoundingClientRect().height
            c.siblingSameH = kids.some((k) => Math.abs(k.getBoundingClientRect().height - myH) < 3 && Math.abs(k.getBoundingClientRect().top - C.getBoundingClientRect().top) < 3)
          }
          causes.push(c)
        }
      }
      // 高さそろえ（並びの中で隣が高いので伸びている）か
      return causes.sort((a, b) => b.reduce - a.reduce).slice(0, 6)
    }
    function testHorizontal(el, maxRight, y1, y2) {
      const causes = []
      const rightOf = () => { let m = 0; for (const it of items) { if (it.y < y2 && it.y + it.h > y1) { const b = toLocal(it.el.getBoundingClientRect()); if (b.y < y2 && b.y + b.h > y1 && b.x + b.w <= rootBox.w) m = Math.max(m, b.x + b.w) } } return m }
      // 計り直しは重いので、祖先の max-width / width だけ試す
      const base = maxRight
      for (let p = el, d = 0; p && p !== R && d < 12; p = p.parentElement, d++) {
        const s = getComputedStyle(p)
        const tests = []
        if (s.maxWidth !== 'none') tests.push(['max-width', 'max-width:none !important', s.maxWidth])
        if (/grid/.test(s.display)) tests.push(['grid-template-columns', 'grid-template-columns:1fr !important', s.gridTemplateColumns.slice(0, 80)])
        if (p.parentElement && /flex/.test(getComputedStyle(p.parentElement).display) && px(s.flexGrow) === 0 && getComputedStyle(p.parentElement).flexDirection === 'row') tests.push(['flex-grow', 'flex-grow:1 !important', s.flexGrow])
        for (const [prop, css, val] of tests) {
          const old = p.getAttribute('style')
          p.setAttribute('style', (old ? old + ';' : '') + css)
          const v = rightOf()
          if (old === null) p.removeAttribute('style'); else p.setAttribute('style', old)
          if (v - base >= 80) causes.push({ sel: selectorOf(p), comp: reactNames(p), prop, val, widen: Math.round(v - base), decl: declOf(p, prop) })
        }
      }
      return causes.slice(0, 5)
    }
    out.meta[root.kind] = { h: Math.round(rootBox.h), w: Math.round(rootBox.w), scrolls, contentBottom: Math.round(rootIsStretched.contentBottom), items: items.length, surfaces: surfaces.size }
  }
  out.declarations = [...document.querySelectorAll('[data-blank-ok]')].map(el => ({
    selector: selectorOf(el), reason: el.getAttribute('data-blank-ok').trim(),
  }))
  out.invalidDeclarations = out.declarations.filter(d => !d.reason)
  return out
}
