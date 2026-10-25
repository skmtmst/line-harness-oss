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

  // 3. 押せない時：灰色に塗り直さず、元の見た目のまま薄くする（影なし・cursor: not-allowed）。
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
  // 4. 動きの時間：transition・animation は共通の --motion-* を読む（動きを減らす設定の 0.01ms は止めるための値）。
  const withoutVars = (value) => { let out = value; while (/var\([^()]*\)/.test(out)) out = out.replace(/var\([^()]*\)/g, ' '); return out }
  for (const { rule, reduced } of rules) {
    if (reduced) continue
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style[i]
      const motionProp = /^(transition|animation)(-duration|-delay)?$/.test(prop) || (/^--[\w-]*(-spin|-enter|transition-duration)$/.test(prop) && !prop.startsWith('--motion-'))
      if (!motionProp) continue
      const value = rule.style.getPropertyValue(prop)
      if (/(?<![\w.-])(?!0m?s\b)\d*\.?\d+m?s\b/.test(withoutVars(value))) add('motion-literal', null, { prop, value: value.trim() }, rule.selectorText)
    }
  }
  return findings
}
