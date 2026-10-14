/** Read existing content and spacing; only the name column receives spare width. */
export function fitListColumns(frame) {
  const table = frame?.querySelector('table')
  const rows = table ? [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr')].filter(row => !row.querySelector('[colspan]') && row.getBoundingClientRect().width) : []
  const body = rows.find(row => row.parentElement.tagName === 'TBODY')
  if (!body) return
  const nameIndex = [...body.children].findIndex(cell => cell.hasAttribute('data-cell-grow') || cell.querySelector('[data-list-name], [data-row-link], [data-list-name-cell]'))
  if (nameIndex < 0) return
  const scope = `${Math.round(frame.getBoundingClientRect().width)}:${body.children.length}:${nameIndex}:${[...body.children].map(cell => cell.getBoundingClientRect().width > 0).join(',')}`
  if (frame.listColumnScope !== scope) {
    for (const row of rows) for (const cell of row.children) {
      cell.removeAttribute('data-content-name-column')
      cell.removeAttribute('data-content-support-column')
      cell.style.removeProperty('--list-content-column-width')
    }
    frame.listColumnScope = scope
    frame.listColumnCeilings = [...body.children].map(cell => cell.getBoundingClientRect().width)
  }
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return
  const controlsOnly = frame.dataset.columnSizing === 'controls'
  const number = value => parseFloat(value) || 0
  const intrinsic = node => {
    if (node.nodeType === 3) {
      if (!node.textContent.trim()) return 0
      const css = getComputedStyle(node.parentElement)
      context.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
      return context.measureText(node.textContent.trim()).width
    }
    if (node.nodeType !== 1) return 0
    const css = getComputedStyle(node)
    if (css.display === 'none' || css.visibility === 'hidden' || node.matches('.sr-only, [hidden], [role="menu"], [role="tooltip"]')) return 0
    if (node.matches('button, input, svg, img, video, [role="button"]')) return node.getBoundingClientRect().width
    const pseudo = position => {
      const style = getComputedStyle(node, position)
      return style.content === 'none' || style.content === 'normal' || style.display === 'none' ? 0 : number(style.width)
    }
    const sizes = [pseudo('::before'), ...[...node.childNodes].map(intrinsic), pseudo('::after')].filter(size => size > 0)
    if (!sizes.length && !node.textContent.trim()) return controlsOnly && number(css.flexGrow) > 0 ? 0 : node.getBoundingClientRect().width
    const inline = css.display === 'inline' || css.display === 'inline-flex' || (css.display === 'flex' && css.flexDirection === 'row')
    const gapItems = controlsOnly ? [...node.childNodes].filter(child => child.nodeType === 3 ? child.textContent.trim() : child.nodeType === 1 && getComputedStyle(child).display !== 'none').length + Number(pseudo('::before') > 0) + Number(pseudo('::after') > 0) : sizes.length
    const content = inline ? sizes.reduce((sum, size) => sum + size, 0) + number(css.columnGap) * Math.max(0, gapItems - 1) : Math.max(0, ...sizes)
    return content + number(css.paddingLeft) + number(css.paddingRight) + number(css.borderLeftWidth) + number(css.borderRightWidth)
  }
  const widths = [...body.children].map((cell, index) => {
    if (index === nameIndex || !cell.getBoundingClientRect().width) return null
    const cells = rows.map(row => row.children[index]).filter(Boolean).filter(cell => cell.getBoundingClientRect().width)
    if (controlsOnly && !cells.some(cell => cell.querySelector('button, input, [role="button"], [data-design-node="xRvDB"]'))) return null
    // A genuinely long secondary value keeps its existing truncation budget.
    const required = Math.max(0, ...cells.map(intrinsic))
    const unbroken = cells.some(cell => cell.matches('[data-list-number]') || cell.querySelector('button, a, input, [data-design-node="xRvDB"], [data-list-date-time]'))
    return Math.ceil(controlsOnly ? Math.max(frame.listColumnCeilings[index], required) : unbroken ? required : Math.min(frame.listColumnCeilings[index], required))
  })
  if (frame.hasAttribute('data-grid-table')) {
    const columns = widths.map(width => width == null ? 'minmax(0, 1fr)' : `${width}px`).join(' ')
    frame.style.setProperty('--table-content-columns', columns)
  }
  // A native fixed-layout table reads <col> before the first row's cell width.
  // Keep its column model in sync with the same measured content budget.
  if (getComputedStyle(body).display !== 'flex') {
    for (const [index, col] of [...table.querySelectorAll(':scope > colgroup > col')].entries()) {
      if (widths[index] != null) col.style.width = `${widths[index]}px`
    }
  }
  for (const row of rows) for (const [index, cell] of [...row.children].entries()) {
    cell.toggleAttribute('data-content-name-column', index === nameIndex)
    cell.toggleAttribute('data-content-support-column', widths[index] !== null && widths[index] !== undefined)
    if (widths[index] !== null && widths[index] !== undefined) {
      const value = `${widths[index]}px`
      if (cell.style.getPropertyValue('--list-content-column-width') !== value) cell.style.setProperty('--list-content-column-width', value)
    }
  }
}
