/** Keep the selected label readable after the real font and icons have rendered. */
export function fitSelectContent(root) {
  const trigger = root?.querySelector('button[aria-haspopup="listbox"]')
  const value = trigger?.querySelector('[data-select-value]')
  if (!trigger || !value || trigger.hasAttribute('data-icon-only') || !value.getBoundingClientRect().width) return
  const range = document.createRange(); range.selectNodeContents(value)
  const textWidth = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect().width : 0
  if (!textWidth) return
  const css = getComputedStyle(trigger)
  const number = value => parseFloat(value) || 0
  const icons = [...trigger.children].filter(child => child !== value && child.getBoundingClientRect().width > 0)
  const width = Math.ceil(textWidth + icons.reduce((sum, icon) => sum + icon.getBoundingClientRect().width, 0)
    + number(css.columnGap) * icons.length + number(css.paddingLeft) + number(css.paddingRight)
    + number(css.borderLeftWidth) + number(css.borderRightWidth))
  const next = `${width}px`
  if (root.style.getPropertyValue('--list-select-content-width') !== next) root.style.setProperty('--list-select-content-width', next)
}
