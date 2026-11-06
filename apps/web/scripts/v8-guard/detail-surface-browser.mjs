/** 実際に描画した右の面を測る。画面の中身・件数を固定しない。 */
export default function scanDetailSurfaces() {
  const errors = []
  const visible = element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden' }
  const surfaces = [...document.querySelectorAll('[data-design-part="detail-panel"], [data-design-part="drawer"], [data-detail-preview]')].filter(visible)
  for (const panel of surfaces) {
    if (panel.querySelector('[data-detail-preview]')) continue
    const header = panel.querySelector(':scope > header')
    const title = header?.querySelector('h2')
    const body = panel.querySelector(':scope > div > [data-detail-content]')
    if (!body) { errors.push({ kind: 'detail-content', name: title?.textContent, measure: '共通の本文がない' }); continue }
    const name = title?.textContent?.trim() || '題なし'
    const fail = (kind, measure) => errors.push({ kind, name, measure })
    if ([...header?.querySelectorAll('[data-row-menu]') ?? []].some(visible)) fail('detail-header-menu', 'その他の操作は下の帯だけに置く')
    const viewport = body.parentElement
    if (viewport.scrollWidth > viewport.clientWidth + 1) fail('detail-body-overflow', { content: viewport.scrollWidth, width: viewport.clientWidth })
    if (!title) fail('detail-title', '題なし')
    else {
      const css = getComputedStyle(title)
      if (Math.abs(parseFloat(css.fontSize) - 16) > .1 || css.fontWeight !== '600' || css.whiteSpace !== 'nowrap' || css.textOverflow !== 'ellipsis' || title.getAttribute('title') !== (title.querySelector('[data-detail-title-text]') ?? title).textContent.trim()) fail('detail-title', { size: css.fontSize, weight: css.fontWeight, nowrap: css.whiteSpace, ellipsis: css.textOverflow, full: title.title })
      const saved = panel.style.getPropertyValue('--detail-title-size')
      const oldTransition = title.style.getPropertyValue('transition'), oldPriority = title.style.getPropertyPriority('transition')
      title.style.setProperty('transition', 'none', 'important')
      panel.style.setProperty('--detail-title-size', '17px')
      const probe = getComputedStyle(title).fontSize
      const follows = Math.abs(parseFloat(probe) - 17) < .1
      if (saved) panel.style.setProperty('--detail-title-size', saved); else panel.style.removeProperty('--detail-title-size')
      void getComputedStyle(title).fontSize
      if (oldTransition) title.style.setProperty('transition', oldTransition, oldPriority); else title.style.removeProperty('transition')
      if (!follows) fail('detail-title-token', { probe, token: getComputedStyle(panel).getPropertyValue('--detail-title-size') })
    }
    for (const field of body.querySelectorAll('[data-detail-field]')) {
      const label = field.querySelector(':scope > [data-detail-label]'), value = field.querySelector(':scope > [data-detail-value]')
      if (label && (Math.abs(parseFloat(getComputedStyle(label).fontSize) - 12) > .1 || getComputedStyle(label).fontWeight !== '500')) fail('detail-label', label.textContent)
      if (value && Math.abs(parseFloat(getComputedStyle(value).fontSize) - 14) > .1) fail('detail-value', value.textContent)
    }
    for (const list of body.querySelectorAll('dl')) if (!list.hasAttribute('data-detail-fields')) fail('detail-field-pair','共通の項目を使っていない')
    for (const label of body.querySelectorAll('dl dt')) {
      const value=label.nextElementSibling
      if (!value || value.tagName !== 'DD') {fail('detail-field-pair',label.textContent);continue}
      if (Math.abs(parseFloat(getComputedStyle(label).fontSize)-12)>.1 || getComputedStyle(label).fontWeight !== '500') fail('detail-label',label.textContent)
      if (Math.abs(parseFloat(getComputedStyle(value).fontSize)-14)>.1) fail('detail-value',value.textContent)
      if (value.getBoundingClientRect().top < label.getBoundingClientRect().bottom-1) fail('detail-field-stack',label.textContent)
    }
    const footer = panel.querySelector(':scope > footer')
    if (footer) {
      const actions = footer.querySelector('[data-detail-actions]')
      if (!actions) fail('detail-footer', '共通の操作帯を使っていない')
      else {
        const rect = footer.getBoundingClientRect()
        const buttons = [...actions.querySelectorAll('button,a[href]')].filter(visible)
        const menu = buttons.filter(button => button.hasAttribute('data-row-menu'))
        const controls = buttons.filter(button => !menu.includes(button))
        const bounds = buttons.map(button => button.getBoundingClientRect())
        if (Math.abs(rect.height - 64) > .1 || menu.length > 1 || controls.length > 2 || buttons.length === 0 || bounds.some(box => box.top < rect.top - 1 || box.bottom > rect.bottom + 1 || box.left < rect.left - 1 || box.right > rect.right + 1) || bounds.some(box => Math.abs((box.top + box.bottom) / 2 - (rect.top + rect.bottom) / 2) > 1)) fail('detail-footer', { height: rect.height, controls: controls.length, menu: menu.length })
        for (let i = 1; i < bounds.length; i++) if (bounds[i].left < bounds[i - 1].right - 1) fail('detail-footer-overlap', buttons.map(button => button.textContent))
        const primary = controls.filter(button => button.getAttribute('data-variant') === 'primary')
        if (primary.length > 1 || primary.length === 1 && primary[0] !== controls.at(-1)) fail('detail-footer-order', controls.map(button => button.textContent))
      }
    }
    if ([...body.querySelectorAll('[data-shared-button][data-variant="primary"]')].some(visible)) fail('detail-body-action', '本文に主操作がある')
  }
  for (const item of [...document.querySelectorAll('[role="menuitem"]')].filter(visible)) {
    if (!/削除|止める|取りやめる|取り消す/.test(item.getAttribute('title') ?? item.textContent)) continue
    const probe = document.createElement('span'); probe.style.color='var(--color-menu-danger)'; item.append(probe)
    const expected=getComputedStyle(probe).color; probe.remove()
    if (getComputedStyle(item).color !== expected) errors.push({kind:'detail-menu-danger',name:item.textContent,measure:{color:getComputedStyle(item).color,expected}})
  }
  return errors
}
