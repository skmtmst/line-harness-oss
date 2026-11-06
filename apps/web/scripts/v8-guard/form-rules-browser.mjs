/** 押せない操作の理由と、色の選択状態を確認する。 */
export default function scanFormRules() {
  const root = document.querySelector('main') || document.body, findings = []
  const visible = el => {
    if (!el) return false
    for (let p = el; p; p = p.parentElement) {
      const c = getComputedStyle(p)
      if (c.display === 'none' || c.visibility !== 'visible' || p.hidden || p.hasAttribute('inert')) return false
      if (p.matches('details:not([open])') && !p.querySelector('summary')?.contains(el)) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  const selector = el => {
    const parts = []
    for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
      const peers = p.parentElement ? [...p.parentElement.children].filter(x => x.tagName === p.tagName) : [p]
      parts.unshift(`${p.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(p) + 1})`)
    }
    return parts.join(' > ')
  }
  const add = (kind, el, text, measure) => findings.push({ kind, target: selector(el), text, measure })
  for (const control of root.querySelectorAll('[data-page-template="create"] button:disabled,[data-page-template="create"] input:disabled,[data-page-template="create"] select:disabled,[data-page-template="create"] textarea:disabled,[data-page-template="create"] [aria-disabled="true"]')) {
    if (!visible(control) || control.closest('[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],.sr-only')) continue
    const described = (control.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id))
    const reason = control.title.trim() || control.getAttribute('aria-description')?.trim() || described.some(el => visible(el) && el.textContent.trim())
    const lead = control.closest('[data-sticky-lead]')
    const leadReason = lead && [...lead.querySelectorAll('[role="note"]')].some(el => visible(el) && el.textContent.trim())
    const busy = control.closest('[aria-busy="true"]') || /読み込|保存中|送信中|処理中/.test(control.textContent)
    if (!reason && !leadReason && !busy) add('form-action-reason', control, '押せない操作に理由を結び付ける', { count: 1 })
  }
  for (const palette of root.querySelectorAll('[data-color-palette="inline"]')) {
    if (!visible(palette)) continue
    const radios = [...palette.querySelectorAll('[role="radio"]')].filter(visible)
    const checked = radios.filter(el => el.getAttribute('aria-checked') === 'true')
    const cleared = radios.some(el => el.getAttribute('aria-label') === '色なし' && el.getAttribute('aria-checked') === 'true')
    if (!cleared && checked.length !== 1) add('form-color', palette, '選んだ色を1つ表示する', { selected: checked.length })

  }
  return findings
}
