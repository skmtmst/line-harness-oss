/**
 * 仕上げの決まり（v8-design-rules.md §6.5・§6.11）を、描かれた画面と読み込まれた CSS から測る。
 * 値の正は globals.css の変数。ここは決まりから外れた物を見つけるだけで、見本の座標や許可表は持たない。
 */
export default function scanPolishRules() {
  const findings = []
  const styles = new Map()
  const css = (el) => { if (!styles.has(el)) styles.set(el, getComputedStyle(el)); return styles.get(el) }
  const visible = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const c = css(p)
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0 || p.hasAttribute('inert')) return false
    }
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
  }
  const selector = (el) => {
    const parts = []
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : ''
      parts.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : ''))
    }
    return parts.slice(-4).join(' > ')
  }
  const add = (kind, el, measure, text = '') => findings.push({ kind, target: el ? selector(el) : '(css)', text: String(text).replace(/\s+/g, ' ').slice(0, 120), measure })
  const CONTROLS = 'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="menuitem"], [role="option"]'

  // 読み込まれた CSS の規則を全部たどる（層・@media の中も）。動きを減らす設定の中は別の決まりなので外す。
  const rules = []
  const walk = (list, reduced) => {
    for (const rule of list) {
      if (rule.cssRules && rule.constructor.name !== 'CSSStyleRule') {
        const isReduced = reduced || (rule.conditionText ?? rule.media?.mediaText ?? '').includes('prefers-reduced-motion: reduce')
        walk(rule.cssRules, isReduced)
      } else if (rule.selectorText) {
        rules.push({ rule, reduced })
        if (rule.cssRules?.length) walk(rule.cssRules, reduced)
      }
    }
  }
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, false) } catch { /* 読めない外部の CSS は測らない */ } }

  // 押せない時（§6.5 の 7）：灰色に塗り直さず、元の見た目のまま薄くする（影なし・cursor: not-allowed）。
  const positive = (sel) => sel.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '')
  const DISABLED = /:disabled|\[disabled\]|\[aria-disabled="?true|\[data-disabled|\.disabled\b|_disabled__/
  for (const { rule } of rules) {
    if (!DISABLED.test(positive(rule.selectorText))) continue
    for (const prop of ['background-color', 'background-image', 'color', 'border-color', 'border-top-color', 'outline-color', '-webkit-text-fill-color']) {
      const v = rule.style.getPropertyValue(prop).trim()
      if (v && !/^(inherit|transparent|none|currentcolor|initial|unset)$/i.test(v) && !(prop === 'background-image' && /^linear-gradient\(color-mix/.test(v))) add('disabled-repaint', null, { prop, value: v }, rule.selectorText)
    }
    const op = rule.style.getPropertyValue('opacity').trim()
    if (/^\.?\d*\.?\d+$/.test(op) && ![0, 1].includes(Number(op))) add('disabled-opacity', null, { value: op }, rule.selectorText)
  }
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (!el.matches(':disabled, [aria-disabled="true"]') || !visible(el)) continue
    let opacity = 1
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) opacity *= +css(p).opacity
    const c = css(el)
    const shadow = c.boxShadow !== 'none'
    const cursor = c.pointerEvents !== 'none' && c.cursor !== 'not-allowed'
    if (opacity < 0.4 || opacity > 0.55 || shadow || cursor) add('disabled-look', el, { opacity: Math.round(opacity * 100) / 100, shadow, cursor: c.cursor }, el.getAttribute('aria-label') || el.textContent)
  }
  // 動きの時間と曲線（§6.11）：transition・animation は共通の --motion-* を読む。
  // 動きを減らす設定の 0.01ms は止めるための値、回り続ける印の linear・steps() は一定の速さのための値なので数えない。
  const withoutVars = (value) => { let out = value; while (/var\([^()]*\)/.test(out)) out = out.replace(/var\([^()]*\)/g, ' '); return out }
  const MOTION = ['transition', 'animation', 'transition-duration', 'animation-duration', 'transition-delay', 'animation-delay', 'transition-timing-function', 'animation-timing-function']
  for (const { rule, reduced } of rules) {
    if (reduced) continue
    // animation: none・transition: none は初期値（ease・0s）で書き出されるので、止める指定として数えない。
    const off = { animation: rule.style.getPropertyValue('animation-name').trim() === 'none', transition: rule.style.getPropertyValue('transition-property').trim() === 'none' }
    const props = new Set(MOTION.filter((prop) => rule.style.getPropertyValue(prop) && !off[prop.split('-')[0]]))
    for (let i = 0; i < rule.style.length; i++) if (/^--[\w-]*(-spin|-enter|transition-duration|transition-timing-function)$/.test(rule.style[i]) && !rule.style[i].startsWith('--motion-')) props.add(rule.style[i])
    for (const prop of props) {
      const value = rule.style.getPropertyValue(prop), plain = withoutVars(value)
      if (/(?<![\w.-])(?!0m?s\b)\d*\.?\d+m?s\b/.test(plain)) add('motion-literal', null, { prop, value: value.trim() }, rule.selectorText)
      if (/(?<![\w-])(ease|ease-in|ease-out|ease-in-out|cubic-bezier)(?![\w-])/.test(plain)) add('motion-curve', null, { prop, value: value.trim() }, rule.selectorText)
    }
  }
  // 印の大きさと線（§6.5 の 5）：ふつう 16・大事な所 20。左メニューの項目は 18、空の表示と画像の置き場の真ん中は 40。線は全部 1.75。
  // 携帯の見本・グラフ・QR・選ぶ欄の中のしるし（チェック・丸）は印ではないので数えない。
  const NOT_ICON = '[data-line-preview-part], [class*="line-preview_"], [class*="liff-phone-frame_"], [class*="phone_"], [class*="chart"], [class*="Chart"], [data-qr-code], [class*="qr"], [class*="checkbox_"], [class*="check-card_box"], [class*="radio_"], [class*="radio-card_radio"], [role="img"], [data-chart]'
  for (const svg of document.querySelectorAll('svg')) {
    const icon = svg.classList.contains('lucide') || (/currentcolor/i.test(svg.getAttribute('stroke') ?? '') && svg.getAttribute('viewBox') === '0 0 24 24')
    if (!icon || svg.closest(NOT_ICON) || !visible(svg)) continue
    // 印の地を svg 自身の余白で描く形（知らせの丸など）は、余白を除いた字面の大きさで見る。
    const sc = css(svg), r = svg.getBoundingClientRect()
    const size = Math.round(Math.max(r.width - parseFloat(sc.paddingLeft) - parseFloat(sc.paddingRight), r.height - parseFloat(sc.paddingTop) - parseFloat(sc.paddingBottom)) * 2) / 2
    // 小さな色の丸の中のしるし（済みのチェック・状態の点）は丸の部品の一部なので、大きさは数えない。
    const holder = svg.parentElement, hc = holder && css(holder), hr = holder?.getBoundingClientRect()
    const mark = hc && hr.width <= 24 && hr.height <= 24 && !/rgba\(0, 0, 0, 0\)|transparent/.test(hc.backgroundColor) && parseFloat(hc.borderTopLeftRadius) >= hr.width / 2 - 1
    const allowed = [16, 20]
    if (svg.closest('[class*="sidebar_item"], [class*="sidebar_link"]')) allowed.push(18)
    if (svg.closest('[data-list-state="empty"], [data-media-slot], [data-empty-mark]')) allowed.push(40)
    if (!mark && !allowed.includes(size)) add('icon-size', svg, { size, allowed }, svg.closest('button, a, [role="button"]')?.getAttribute('aria-label') ?? '')
    const stroke = parseFloat(sc.strokeWidth)
    if (Math.abs(stroke - 1.75) > 0.01) add('icon-stroke', svg, { stroke }, '')
  }
  // 共通のボタン・→つきのリンク・パンくずの家の中の、印と文字の間は 8（§6.5 の 5）。
  const textBox = (el) => {
    const rects = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || node.parentElement.closest('svg, [aria-hidden="true"]:not(svg)')) continue
      const range = document.createRange(); range.selectNodeContents(node)
      for (const rect of range.getClientRects()) if (rect.width > 0) rects.push(rect)
    }
    return rects.length ? { left: Math.min(...rects.map((x) => x.left)), right: Math.max(...rects.map((x) => x.right)), top: Math.min(...rects.map((x) => x.top)), bottom: Math.max(...rects.map((x) => x.bottom)) } : null
  }
  for (const el of document.querySelectorAll('[class*="button_button"], [class*="text-link_root"], [class*="top-bar_crumbHome"]')) {
    if (!visible(el)) continue
    const svg = [...el.querySelectorAll(':scope > svg, :scope > span > svg:only-child')].find(visible), text = textBox(el)
    if (!svg || !text) continue
    const r = svg.getBoundingClientRect()
    if (r.top >= text.bottom || r.bottom <= text.top) continue
    const gap = r.right <= text.left + 0.5 ? text.left - r.right : r.left >= text.right - 0.5 ? r.left - text.right : null
    if (gap !== null && Math.abs(gap - 8) > 0.5) add('button-icon-gap', el, { gap: Math.round(gap * 10) / 10 }, el.textContent)
  }
  // 仕上げ（§6.5 の 7）：文字を選んだ時の地（ブランドの深い緑の薄い色）・端末のタップの光なし・画像の幅と高さ・動きを減らす設定の遅れなし。
  // 画面全体の値なので、アプリの CSS を読んだ V8 の画面（data-theme="v8"）だけで見る。
  if (document.documentElement.dataset.theme === 'v8') {
    const selection = getComputedStyle(document.body, '::selection').backgroundColor
    if (/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(selection)) add('selection-color', document.body, { selection })
    const tap = css(document.documentElement).webkitTapHighlightColor
    if (tap && !/rgba\(0, 0, 0, 0\)|transparent/.test(tap)) add('tap-highlight', document.documentElement, { tap })
  }
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img) || (img.hasAttribute('width') && img.hasAttribute('height'))) continue
    // 元の大きさのまま出す写真（幅を CSS が決めない物）は、属性で幅を決めると見た目が変わるので数えない。
    const fixed = (prop) => { const v = img.style[prop] || [...rules].reverse().find(({ rule }) => img.matches(rule.selectorText) && rule.style[prop] && rule.style[prop] !== 'auto')?.rule.style[prop]; return Boolean(v) }
    if (fixed('width') || fixed('height')) add('img-size', img, { width: img.getAttribute('width'), height: img.getAttribute('height') }, img.alt)
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const el of document.querySelectorAll('body *')) {
      const c = css(el)
      const delayed = (c.animationName !== 'none' && c.animationDelay.split(',').some((v) => parseFloat(v) > 0)) || (c.transitionProperty !== 'none' && c.transitionDelay.split(',').some((v) => parseFloat(v) > 0))
      if (delayed) { add('reduced-motion-delay', el, { animation: c.animationDelay, transition: c.transitionDelay }); break }
    }
  }
  // 左メニューの件数の札：読み上げは「名前、N件」と区切り、札の数字は読ませない。
  for (const link of document.querySelectorAll('nav a[href], aside a[href]')) {
    const badge = [...link.querySelectorAll('span')].find((span) => !span.children.length && /^\d+\+?$/.test(span.textContent.trim()) && visible(span))
    if (!badge) continue
    const label = link.getAttribute('aria-label') ?? ''
    if (!/、\d+件$/.test(label) || !badge.closest('[aria-hidden="true"]')) add('nav-count-name', link, { label, badgeHidden: Boolean(badge.closest('[aria-hidden="true"]')) }, link.textContent)
  }
  // 「？」（§6.5 の 7）：押せる範囲は 28×28、見た目の丸は 16、隣の見出し・ラベル・札との間は 8。
  for (const button of document.querySelectorAll('[class*="help-tip_button"]:not([data-help-trigger="text"])')) {
    if (!visible(button)) continue
    const mark = button.querySelector('svg, [class*="help-tip_mark"]')
    const br = button.getBoundingClientRect(), mr = mark?.getBoundingClientRect()
    const wrap = button.closest('[class*="help-tip_wrap"]') ?? button
    let before = null
    for (let node = wrap.previousSibling; node && !before; node = node.previousSibling) {
      if (node.nodeType === 3 && node.textContent.trim()) { const last = node.textContent.trimEnd().length - 1, range = document.createRange(); range.setStart(node, last); range.setEnd(node, last + 1); before = range.getBoundingClientRect() }
      else if (node.nodeType === 1 && visible(node)) before = node.getBoundingClientRect()
    }
    // 文字の後ろの空白は字の箱に入るので、空白を除いた最後の字の右端で見る。
    const gap = before && mr && Math.abs((before.top + before.bottom) / 2 - (mr.top + mr.bottom) / 2) < 12 ? mr.left - before.right : null
    const bad = br.width < 28 || br.height < 28 || (mr && Math.abs(Math.max(mr.width, mr.height) - 16) > 0.5) || (gap !== null && gap < 30 && Math.abs(gap - 8) > 0.5)
    if (bad) add('help-tip', button, { hit: `${Math.round(br.width)}x${Math.round(br.height)}`, mark: mr ? Math.round(mr.width) : null, gap: gap === null ? null : Math.round(gap * 10) / 10 }, button.getAttribute('aria-label'))
  }
  return findings
}
