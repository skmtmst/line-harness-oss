/** F組 P〜S。共通部品の実寸と可視の文字で見る。許可で除外する種類は持たない。 */
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
  for (const input of root.querySelectorAll('input[placeholder]')) {
    if (!visible(input) || !/言葉を入れて.*Enter/.test(input.placeholder)) continue
    const entry = input.closest('[data-keyword-input]')
    const frame = entry?.firstElementChild ?? input
    const css = getComputedStyle(frame)
    const hasFrame = (css.borderTopStyle !== 'none' && parseFloat(css.borderTopWidth) > 0) || (css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0)
    const field = input.closest('[data-form-requirement]')
    const unnamedLabel = field?.querySelector('label')?.textContent.trim() === ''
    if (!hasFrame || unnamedLabel) add('form-keyword-input', input, '言葉を足す欄は箱つきで、名前のない札を出さない', { frame: Number(hasFrame), unnamedLabel: Number(unnamedLabel) })
  }
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
    for (const radio of radios) {
      const r = radio.getBoundingClientRect(), css = getComputedStyle(radio)
      if (r.width !== 24 || r.height !== 24) add('form-color', radio, '色を選ぶ丸は24px', { width: r.width, height: r.height })
      if (checked.includes(radio) && (css.outlineStyle === 'none' || parseFloat(css.outlineWidth) < 2)) add('form-color', radio, '選んだ色には輪を出す', { outline: parseFloat(css.outlineWidth) || 0 })
    }
  }
  for (const lead of root.querySelectorAll('[data-sticky-lead]')) for (const button of lead.querySelectorAll('button')) {
    if (!visible(button)) continue
    const css = getComputedStyle(button)
    const hasFrame = (css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0) || (css.borderTopStyle !== 'none' && parseFloat(css.borderTopWidth) > 0)
    const white = ['rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)'].includes(css.backgroundColor)
    if (!hasFrame || !white || !button.querySelector('svg')) add('form-footer-action', button, '左端の操作は印つき副ボタン', { frame: Number(hasFrame), white: Number(white), icon: Number(Boolean(button.querySelector('svg'))) })
    if (button.disabled && ![...lead.querySelectorAll('[role="note"]')].some(el => visible(el) && el.textContent.trim())) add('form-footer-action', button, '押せない操作の理由を表示する', { reason: 0 })
  }
  for (const heading of root.querySelectorAll('h2,h3,label')) {
    if (visible(heading) && /[（(]任意[）)]/.test(heading.textContent)) add('form-optional', heading, '任意は題と分けて札で表示する', { count: 1 })
  }
  for (const element of root.querySelectorAll('h2,h3,label,button')) {
    if (visible(element) && /[（(]\s*(?:and|or)\s*条件\s*[）)]/i.test(element.textContent)) add('form-copy', element, '条件の意味は日本語で表示する', { count: 1 })
  }
  for (const frame of root.querySelectorAll('[data-page-template="create"]')) {
    const heading = frame.querySelector('[data-template-region="heading"]')
    const title = heading?.querySelector('h1,h2')
    if (!title || !visible(title)) continue
    const helpNames = [`${title.textContent.trim()}の説明`, '画面の説明', 'この画面の説明']
    const hasHelp = [...heading.querySelectorAll('button')].some(button => visible(button) && (helpNames.includes(button.getAttribute('aria-label')) || button.textContent.includes('この画面の説明')) && (button.hasAttribute('aria-expanded') || button.hasAttribute('aria-describedby')))
    if (!hasHelp) add('form-help', title, '作成・編集の題から画面の説明を開く', { count: 1 })
  }
  for (const row of root.querySelectorAll('[data-form-row="name-folder"]')) {
    if (!visible(row)) continue
    const last = row.lastElementChild
    const controls = [...last.querySelectorAll('input:not([type="hidden"]),button[aria-haspopup]')].filter(visible)
    for (const control of controls) {
      const boundary = control.closest('[data-entity-picker-field]') ?? control
      const delta = row.getBoundingClientRect().right - boundary.getBoundingClientRect().right
      if (Math.abs(delta) > 1 / 64) add('form-row-end', control, '並んだ最後の欄を行の右端へそろえる', { delta: Math.abs(delta) })
    }
  }
  for (const frame of root.querySelectorAll('[data-page-template="create"]')) {
    if (!visible(frame) || frame.getBoundingClientRect().width >= 1100) continue
    for (const preview of frame.querySelectorAll('[data-template-region="preview"]')) {
      if (visible(preview)) add('form-shrink', preview, '狭い白い板では右欄を畳む', { width: preview.getBoundingClientRect().width })
    }
    for (const row of frame.querySelectorAll('[data-form-row="name-folder"]')) {
      if (!visible(row)) continue
      const children = [...row.children].filter(visible)
      if (children.length > 1 && children[1].getBoundingClientRect().top < children[0].getBoundingClientRect().bottom) add('form-shrink', row, '狭い白い板では名前とフォルダを1列へ', { columns: children.length })
    }
  }
  return findings
}
