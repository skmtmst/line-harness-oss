/** Measure the actual band, including expanded chips and the readable search minimum.
 * @param {HTMLElement} toolbar
 * @param {HTMLElement | null} [expandedItem]
 * @param {number} [expandedWidth]
 * @param {boolean} [includeExpanded]
 * @param {boolean} [secondary]
 */
export function toolbarContentFit(toolbar, expandedItem = null, expandedWidth = 0, includeExpanded = true, secondary = false) {
  const flatten = element => getComputedStyle(element).display === 'contents'
    ? [...element.children].flatMap(flatten) : [element]
  const tools = [...toolbar.children].flatMap(flatten).filter(tool => {
    const css = getComputedStyle(tool)
    const spacer = css.flexGrow !== '0' && !tool.textContent.trim() && !tool.querySelector('button,input')
    return css.display !== 'none' && !spacer
      && !(secondary && tool.matches('[data-toolbar-leading], [data-toolbar-role="search"]'))
      && !tool.matches('[data-toolbar-secondary], [data-design-part="notice"], :has(> [data-design-part="notice"])')
  })
  const css = getComputedStyle(toolbar), gap = parseFloat(css.columnGap) || 0
  const available = toolbar.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0)
  const required = tools.reduce((sum, tool) => {
    // A flex item can shrink while its controls keep their intrinsic width.
    // Counting only that smaller box makes an overflowing band look like it fits.
    let width = Math.max(tool.getBoundingClientRect().width, tool.scrollWidth)
    if (tool.matches('[data-toolbar-search]')) {
      const minimum = parseFloat(getComputedStyle(tool).getPropertyValue('--list-search-content-min'))
      if (minimum > 0) width = Math.min(width, minimum)
    }
    // A growing overflow group fills spare space, not just its controls' demand.
    // Its existing natural-width measurement also avoids rounded scrollWidth feedback.
    const optional = tool.matches('[data-toolbar-overflow-group]') ? tool : tool.querySelector('[data-toolbar-overflow-group]')
    const natural = optional && !optional.hasAttribute('data-collapsed') ? parseFloat(optional.style.getPropertyValue('--toolbar-optional-width')) : 0
    const growing = natural > 0 && parseFloat(getComputedStyle(optional).flexGrow) > 0
    if (growing) width = Math.max(0, width - Math.max(optional.getBoundingClientRect().width, optional.scrollWidth)) + natural
    if (expandedItem && (tool === expandedItem || tool.contains(expandedItem))) width += Math.max(0, expandedWidth - (growing && optional === expandedItem ? natural : expandedItem.getBoundingClientRect().width))
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

/** Reserve a readable control even when an old wrapper is narrower than it.
 * @param {HTMLElement} item
 */
export function fitToolbarOptionalWidth(item) {
  const content = item.querySelector('[data-toolbar-optional-content]')
  if (!content || item.hasAttribute('data-collapsed')) return 0
  const children = [...content.children].filter(el => getComputedStyle(el).display !== 'none')
  const intrinsic = children.reduce((sum, el) => sum + Math.max(el.getBoundingClientRect().width, el.scrollWidth), 0)
    + (parseFloat(getComputedStyle(content).columnGap) || 0) * Math.max(0, children.length - 1)
  const width = Math.ceil(item.hasAttribute('data-toolbar-overflow-group') ? intrinsic : Math.max(content.getBoundingClientRect().width, content.scrollWidth))
  item.style.setProperty('--toolbar-optional-width', `${width}px`)
  return width
}

/** Keep an expanded overflow panel inside its toolbar, including near the right edge.
 * @param {HTMLElement} item
 * @param {HTMLElement} toolbar
 */
export function fitToolbarOverflowPanel(item, toolbar) {
  const content = item.querySelector('[data-toolbar-optional-content]')
  if (!content) return
  const bounds = toolbar.getBoundingClientRect(), anchor = item.getBoundingClientRect()
  const css = getComputedStyle(toolbar)
  const left = bounds.left + (parseFloat(css.paddingLeft) || 0)
  const right = Math.min(bounds.right - (parseFloat(css.paddingRight) || 0), window.innerWidth)
  const available = Math.max(0, Math.floor(right - left))
  const width = Math.min(content.getBoundingClientRect().width, available)
  const offset = Math.max(left - anchor.left, Math.min(0, right - anchor.left - width))
  item.style.setProperty('--toolbar-optional-panel-width', `${available}px`)
  item.style.setProperty('--toolbar-optional-panel-left', `${Math.floor(offset)}px`)
}

/** Keep the observer on rerender; remeasure changed props without duplicate initial delivery.
 * @param {HTMLElement} item
 * @param {() => Element[]} targets
 * @param {() => void} measure
 * @param {boolean} [toggle]
 */
export function observeToolbarContent(item, targets, measure, toggle = false) {
  let active = true, frame = 0, content = ''
  let watched = new Set()
  const read = () => { if (active && item.isConnected) measure() }
  const queue = () => { if (active) { cancelAnimationFrame(frame); frame = requestAnimationFrame(read) } }
  const observer = new ResizeObserver(queue)
  const refresh = () => {
    if (!active) return
    const nextContent = item.innerHTML
    if (content !== nextContent || !watched.size) {
      content = nextContent
      const next = new Set(targets())
      for (const target of watched) if (!next.has(target)) observer.unobserve(target)
      for (const target of next) if (!watched.has(target)) observer.observe(target)
      watched = next
    }
    read()
  }
  refresh()
  if (toggle) item.addEventListener('toggle', queue)
  // Already-loaded fonts do not change the initial measurement.
  if (document.fonts?.status === 'loading') void document.fonts.ready.then(read)
  return { refresh, stop: () => {
    active = false
    if (toggle) item.removeEventListener('toggle', queue)
    cancelAnimationFrame(frame); observer.disconnect()
  } }
}
