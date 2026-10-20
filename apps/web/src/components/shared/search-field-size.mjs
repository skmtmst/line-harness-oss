/** : reserve the actual placeholder and the control's existing padding/icon. */
export function fitListSearchPlaceholder(input) {
  const slot = input?.closest('[data-toolbar-search]')
  const control = input?.parentElement
  if (!input || !slot || !control || !input.placeholder || !input.getBoundingClientRect().width) return
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return
  const textStyle = getComputedStyle(input), controlStyle = getComputedStyle(control)
  context.font = `${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`
  const chrome = (control.querySelector('svg')?.getBoundingClientRect().width ?? 0)
    + (parseFloat(controlStyle.columnGap) || 0)
    + (parseFloat(controlStyle.paddingLeft) || 0) + (parseFloat(controlStyle.paddingRight) || 0)
    + (parseFloat(textStyle.paddingLeft) || 0) + (parseFloat(textStyle.paddingRight) || 0)
  const width = `${Math.ceil(context.measureText(input.placeholder).width + chrome)}px`
  if (slot.style.getPropertyValue('--list-search-content-min') !== width) slot.style.setProperty('--list-search-content-min', width)
}
