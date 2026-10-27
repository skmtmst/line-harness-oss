/**
 * 「乗せた時だけ出す」物の決まり：押せる物を薄く隠しているなら、焦点でも出し、タッチの端末（乗せられない）では常に出す。
 * page.evaluate で単独に動く。
 *
 * 見る物：main の中の押せる物（ボタン・リンク・入力欄・tabindex）で、見た目の不透明度（親までの積）が 0.5 未満の物。
 * - 焦点を当てても 0.5 未満のまま → hover-focus
 * - `@media (hover: none)` の中に、その物を 0.5 より濃くするルールが無い → hover-touch
 * チェックボックス・ラジオ・ファイルの入力は、見た目を別の部品で描くため透明にするので数えない。
 * 調べ終えたら焦点を元へ戻す。
 */
export default function scanHoverReveal() {
  const findings = []
  const root = document.querySelector('main') || document.body
  const selector = el => {
    const parts = []
    for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/).filter(Boolean)[0] : ''
      const peers = p.parentElement ? [...p.parentElement.children].filter(s => s.tagName === p.tagName) : [p]
      parts.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : '') + ':nth-of-type(' + (peers.indexOf(p) + 1) + ')')
    }
    return parts.join(' > ')
  }
  const settle = () => { for (const a of document.getAnimations()) { try { a.finish() } catch { /* 終わりの無い動きはそのまま */ } } }
  const opacity = el => {
    let value = 1
    for (let p = el; p; p = p.parentElement) value *= Number(getComputedStyle(p).opacity)
    return value
  }
  const laidOut = el => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    for (let p = el; p; p = p.parentElement) {
      const c = getComputedStyle(p)
      if (c.display === 'none' || c.visibility === 'hidden' || p.hasAttribute('inert')) return false
    }
    return true
  }
  // タッチの端末で効くルール（@media (hover: none) の中で不透明度を上げる物）の選び方を集める。
  const touchSelectors = []
  const collect = (rules, touch) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule) collect(rule.cssRules, touch || /hover:\s*none/.test(rule.conditionText ?? rule.media.mediaText))
      else if (rule.cssRules && !(rule instanceof CSSStyleRule)) collect(rule.cssRules, touch)
      else if (touch && rule instanceof CSSStyleRule && rule.style.opacity !== '' && Number(rule.style.opacity) > 0.5) touchSelectors.push(rule.selectorText)
      if (rule instanceof CSSStyleRule && rule.cssRules?.length) collect(rule.cssRules, touch)
    }
  }
  for (const sheet of document.styleSheets) { try { collect(sheet.cssRules, false) } catch { /* 別の出どころの CSS は読めない */ } }
  const touchShows = el => {
    for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
      if (touchSelectors.some(s => { try { return p.matches(s) } catch { return false } })) return true
    }
    return false
  }
  const before = document.activeElement
  settle()
  const candidates = [...root.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.matches('input[type="checkbox"],input[type="radio"],input[type="file"],input[type="hidden"],[disabled]') && laidOut(el) && opacity(el) < 0.5)
  for (const el of candidates) {
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    el.focus({ preventScroll: true })
    settle()
    if (document.activeElement === el && opacity(el) < 0.5) findings.push({ kind: 'hover-focus', target: selector(el), text: label, measure: { opacity: Math.round(opacity(el) * 100) / 100 } })
    el.blur()
    settle()
    if (!touchShows(el)) findings.push({ kind: 'hover-touch', target: selector(el), text: label })
  }
  if (before instanceof HTMLElement) before.focus({ preventScroll: true })
  return findings
}
