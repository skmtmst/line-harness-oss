/** Read existing content and spacing; only the name column receives spare width. */
export function fitListColumns(frame) {
  const table = frame?.querySelector('table')
  const rows = table ? [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr')].filter(row => !row.querySelector('[colspan]') && row.getBoundingClientRect().width) : []
  const body = rows.find(row => row.parentElement.tagName === 'TBODY')
  if (!body) return
  const nameIndex = [...body.children].findIndex(cell => cell.hasAttribute('data-cell-grow') || cell.querySelector('[data-list-name], [data-row-link], [data-list-name-cell]'))
  if (nameIndex < 0) return
  const flexibleContent = frame.dataset.columnSizing === 'content'
  const scope = `${Math.round(frame.getBoundingClientRect().width)}:${body.children.length}:${nameIndex}:${[...body.children].map(cell => cell.getBoundingClientRect().width > 0).join(',')}:${flexibleContent ? rows.map(row => row.textContent).join('\n') : ''}`
  const cols = [...table.querySelectorAll(':scope > colgroup > col')]
  for (const col of cols) if (col.listColumnOriginalWidth === undefined) col.listColumnOriginalWidth = col.style.width
  if (frame.listColumnScope !== scope) {
    for (const col of cols) col.style.width = col.listColumnOriginalWidth
    for (const row of rows) for (const cell of row.children) {
      cell.removeAttribute('data-content-name-column')
      cell.removeAttribute('data-content-support-column')
      cell.style.removeProperty('--list-content-column-width')
    }
    frame.listColumnScope = scope
    frame.listColumnCeilings = [...body.children].map((cell, index) => flexibleContent ? Math.max(...rows.map(row => row.children[index]?.getBoundingClientRect().width ?? 0)) : cell.getBoundingClientRect().width)
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
    // 割合を指定した列は、残りを割合で分け合う列。中身で測らない。
    if (index === nameIndex || cell.hasAttribute('data-cell-weight') || !cell.getBoundingClientRect().width) return null
    const cells = rows.map(row => row.children[index]).filter(Boolean).filter(cell => cell.getBoundingClientRect().width)
    if (controlsOnly && !cells.some(cell => cell.querySelector('button, input, [role="button"], [data-design-node="xRvDB"]'))) return null
    const required = Math.max(0, ...cells.map(intrinsic))
    if (controlsOnly) return Math.ceil(Math.max(frame.listColumnCeilings[index], required))
    if (flexibleContent) return Math.ceil(required)
    const unbroken = cells.some(cell => cell.matches('[data-list-number], [data-list-date-time]') || cell.querySelector('a, [data-list-date-time]'))
    return Math.ceil(unbroken ? required : Math.min(frame.listColumnCeilings[index], required))
  })
  if (flexibleContent && !controlsOnly && ![...body.children].some(cell => cell.hasAttribute('data-cell-weight'))) {
    const nameBudget = number(getComputedStyle(body.children[nameIndex]).minWidth)
    const fixed = widths.map((_, index) => rows.some(row => {
      const cell = row.children[index]
      return cell && (cell.matches('[data-list-number], [data-list-date-time]') || cell.querySelector('button,input,a,[role="button"],[data-list-date-time]'))
    }))
    const controls = widths.reduce((sum, width, index) => sum + (fixed[index] ? width ?? 0 : 0), 0)
    const available = Math.max(0, table.getBoundingClientRect().width - nameBudget - controls)
    const total = widths.reduce((sum, width, index) => sum + (fixed[index] ? 0 : width ?? 0), 0)
    if (total > available) {
      let low = 0, high = Math.max(...widths.map(width => width ?? 0))
      for (let step = 0; step < 24; step++) {
        const cap = (low + high) / 2
        if (widths.reduce((sum, width, index) => sum + (fixed[index] ? 0 : Math.min(width ?? 0, cap)), 0) > available) high = cap
        else low = cap
      }
      widths.forEach((width, index) => { if (width !== null && !fixed[index]) widths[index] = Math.min(width, low) })
    }
  }
  // 割合（weight）を指定した列：測った列を除いた残りの幅を、割合で分ける（実寸の px にして、ほかの測った列と同じ道で渡す）。
  const weights = [...body.children].map(cell => Number(cell.dataset.cellWeight) || 0)
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightTotal > 0) {
    const fixed = widths.reduce((sum, width, index) => sum + (width && !weights[index] ? width : 0), 0)
    const room = Math.max(0, table.getBoundingClientRect().width - fixed)
    weights.forEach((weight, index) => { if (weight > 0 && body.children[index].getBoundingClientRect().width) widths[index] = Math.floor(room * weight / weightTotal) })
  }
  if (frame.hasAttribute('data-grid-table') || frame.hasAttribute('data-table-density')) {
    const columns = widths.map(width => width == null ? 'minmax(0, 1fr)' : `${width}px`).join(' ')
    frame.style.setProperty('--table-content-columns', columns)
  }
  // A native fixed-layout table reads <col> before the first row's cell width.
  // Keep its column model in sync with the same measured content budget.
  if (getComputedStyle(body).display !== 'flex') {
    for (const [index, col] of [...table.querySelectorAll(':scope > colgroup > col')].entries()) {
      col.style.width = widths[index] != null ? `${widths[index]}px` : col.listColumnOriginalWidth
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
