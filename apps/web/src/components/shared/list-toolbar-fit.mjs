/** Measure the actual band, including expanded chips and the readable search minimum.
 * @param {HTMLElement} toolbar
 * @param {HTMLElement | null} [expandedItem]
 * @param {number} [expandedWidth]
 * @param {boolean} [includeExpanded]
 */
export function toolbarContentFit(toolbar, expandedItem = null, expandedWidth = 0, includeExpanded = true) {
  const flatten = element => getComputedStyle(element).display === 'contents'
    ? [...element.children].flatMap(flatten) : [element]
  const tools = [...toolbar.children].flatMap(flatten).filter(tool => {
    const css = getComputedStyle(tool)
    return css.display !== 'none' && css.flexGrow === '0'
      && !tool.matches('[data-design-part="notice"], :has(> [data-design-part="notice"])')
  })
  const css = getComputedStyle(toolbar), gap = parseFloat(css.columnGap) || 0
  const available = toolbar.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0)
  const required = tools.reduce((sum, tool) => {
    let width = tool.getBoundingClientRect().width
    if (tool.matches('[data-toolbar-search]')) {
      const minimum = parseFloat(getComputedStyle(tool).getPropertyValue('--list-search-content-min'))
      if (minimum > 0) width = Math.min(width, minimum)
    }
    if (expandedItem && (tool === expandedItem || tool.contains(expandedItem))) width += Math.max(0, expandedWidth - expandedItem.getBoundingClientRect().width)
    for (const group of includeExpanded ? tool.matches('[data-filter-width]') ? [tool] : [...tool.querySelectorAll('[data-filter-width]')] : []) {
      width += Math.max(0, Number(group.dataset.filterWidth) - group.getBoundingClientRect().width)
    }
    return sum + width
  }, 0) + gap * Math.max(0, tools.length - 1)
  return { available, required, fits: required <= available }
}

/** The remaining controls may need a second row even after optional tools collapse.
 * @param {HTMLElement} toolbar
 */
export function fitToolbarWrap(toolbar) {
  toolbar.dataset.toolbarFit = toolbarContentFit(toolbar, null, 0, false).fits ? 'single' : 'wrap'
}
