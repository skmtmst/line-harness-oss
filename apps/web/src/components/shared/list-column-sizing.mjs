/** Read existing content and spacing; only the name column receives spare width. */
export function fitListColumns(frame) {
  const table = frame?.querySelector('table')
  const rows = table ? [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr')].filter(row => !row.querySelector('[colspan]') && row.getBoundingClientRect().width) : []
  const body = rows.find(row => row.parentElement.tagName === 'TBODY')
  if (!body) return
  const nameIndex = [...body.children].findIndex(cell => cell.hasAttribute('data-cell-grow') || cell.querySelector('[data-list-name], [data-row-link], [data-list-name-cell]'))
  if (nameIndex < 0) return
  const flexibleContent = frame.hasAttribute('data-column-layout') && frame.dataset.columnSizing === 'content'
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
  const controlsOnly = frame.dataset.columnSizing === 'controls'
  const number = value => parseFloat(value) || 0
  const textWidth = node => {
    const css = getComputedStyle(node.nodeType === 3 ? node.parentElement : node)
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0)
    if (rects.length <= 1) return range.getBoundingClientRect().width
    const probe = document.createElement('span')
    probe.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;pointer-events:none'
    for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantNumeric', 'fontVariationSettings', 'fontFeatureSettings', 'letterSpacing', 'wordSpacing']) probe.style[key] = css[key]
    probe.textContent = node.textContent.trim()
    document.body.append(probe)
    try { return probe.getBoundingClientRect().width } finally { probe.remove() }
  }
  const intrinsic = node => {
    if (node.nodeType === 3) return node.textContent.trim() ? textWidth(node) : 0
    if (node.nodeType !== 1) return 0
    const css = getComputedStyle(node)
    if (css.display === 'none' || css.visibility === 'hidden' || node.matches('.sr-only, [hidden], [role="menu"], [role="tooltip"]')) return 0
    if (node.matches('button, input, svg, img, video, [role="button"]') && !node.matches('[data-part="row-name"]')) return node.getBoundingClientRect().width
    const pseudo = position => {
      const style = getComputedStyle(node, position)
      return style.content === 'none' || style.content === 'normal' || style.display === 'none' ? 0 : number(style.width)
    }
    const textOnly = node.childElementCount === 0 && node.textContent.trim()
    const sizes = [pseudo('::before'), ...(textOnly ? [textWidth(node)] : [...node.childNodes].map(intrinsic)), pseudo('::after')].filter(size => size > 0)
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
    const unbroken = cells.some(cell => cell.matches('[data-list-number]') || cell.querySelector('button, a, input, [data-design-node="xRvDB"], [data-list-date-time]'))
    return Math.ceil(unbroken ? required : Math.min(frame.listColumnCeilings[index], required))
  })
  frame.removeAttribute('data-content-stacked')
  if (flexibleContent && !controlsOnly && ![...body.children].some(cell => cell.hasAttribute('data-cell-weight'))) {
    const header = rows.find(row => row.parentElement.tagName === 'THEAD')
    const shortContentWidth = cell => {
      const content = [cell, ...cell.querySelectorAll('*')].filter(node => node.childElementCount === 0 && node.getBoundingClientRect().width && node.textContent.trim() && !node.closest('[hidden], [aria-hidden="true"], .sr-only, [role="note"]'))
      const leaves = content.filter(node => node.textContent.trim().replace(/\s/g, '').length <= 16)
      if (content.length && leaves.length === content.length) return intrinsic(cell)
      const padding = getComputedStyle(cell)
      return Math.max(0, ...leaves.map(textWidth)) + number(padding.paddingLeft) + number(padding.paddingRight)
    }
    const minimum = widths.map((width, index) => width === null ? 0 : Math.min(width, Math.max(header?.children[index] ? intrinsic(header.children[index]) : 0, number(getComputedStyle(body.children[index]).fontSize), ...rows.map(row => row.children[index] ? shortContentWidth(row.children[index]) : 0))))
    const fixed = widths.map((_, index) => rows.some(row => {
      const cell = row.children[index]
      return cell && (cell.matches('[data-list-number], [data-list-date-time]') || cell.querySelector('button,input,a,[role="button"],[data-list-date-time]'))
    }))
    const controls = widths.reduce((sum, width, index) => sum + (fixed[index] ? width ?? 0 : 0), 0)
    const rowStyle = getComputedStyle(body)
    const contentBudget = table.getBoundingClientRect().width - number(rowStyle.paddingLeft) - number(rowStyle.paddingRight) - number(rowStyle.columnGap) * (body.children.length - 1)
    const nameContent = Math.max(...rows.map(row => intrinsic(row.children[nameIndex])))
    const nameMinimum = Math.max(number(getComputedStyle(body.children[nameIndex]).minWidth), header?.children[nameIndex] ? intrinsic(header.children[nameIndex]) : 0, ...rows.map(row => row.children[nameIndex] ? shortContentWidth(row.children[nameIndex]) : 0))
    const minimumTotal = minimum.reduce((sum, width, index) => sum + (fixed[index] ? 0 : width), 0)
    const nameBudget = Math.max(nameMinimum, Math.min(nameContent, contentBudget - controls - minimumTotal))
    const available = Math.max(0, contentBudget - nameBudget - controls)
    const total = widths.reduce((sum, width, index) => sum + (fixed[index] ? 0 : width ?? 0), 0)
    const mustStack = minimumTotal + controls + nameMinimum > contentBudget
    frame.toggleAttribute('data-content-stacked', mustStack)
    if (mustStack) {
      widths.forEach((width, index) => { if (width !== null && !fixed[index]) widths[index] = minimum[index] })
    } else if (total > available) {
      let low = 0, high = Math.max(...widths.map(width => width ?? 0))
      for (let step = 0; step < 24; step++) {
        const cap = (low + high) / 2
        if (widths.reduce((sum, width, index) => sum + (fixed[index] ? 0 : Math.max(minimum[index], Math.min(width ?? 0, cap))), 0) > available) high = cap
        else low = cap
      }
      widths.forEach((width, index) => { if (width !== null && !fixed[index]) widths[index] = Math.max(minimum[index], Math.min(width, low)) })
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
