/** F組 P〜S。共通部品の実寸と可視の文字で見る。許可で除外する種類は持たない。 */
export default function scanFormRules() {
  const root = document.querySelector('main') || document.body, findings = []
  const visible = el => {
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
  for (const row of root.querySelectorAll('[data-form-row="name-folder"]')) {
    if (!visible(row)) continue
    const last = row.lastElementChild
    const controls = [...last.querySelectorAll('input:not([type="hidden"]),button[aria-haspopup]')].filter(visible)
    for (const control of controls) {
      const delta = row.getBoundingClientRect().right - control.getBoundingClientRect().right
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
