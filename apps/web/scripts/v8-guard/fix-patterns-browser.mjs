/** : rendered evidence. Presence is separate from defects; API/rights
 * differences require a stated reason, never an allowance or a guessed zero. */
export default function scanFixPatterns({ cssOwners = [] } = {}) {
  const counts = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`F${i + 1}`, 0]))
  const findings = [], inventory = []
  const visible = el => !!el && el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1
    && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert],[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],.sr-only')
  const add = (pattern, el, reason) => {
    counts[pattern]++
    findings.push({ pattern, reason, text: el.textContent?.trim().slice(0, 90) ?? '', label: el.getAttribute('aria-label') })
  }
  const textRects = (el, exclude) => {
    const rects = [], walker = document.createTreeWalker(el, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !visible(node.parentElement) || node.parentElement.closest('svg') || exclude?.contains(node.parentElement)) continue
      const range = document.createRange(); range.selectNodeContents(node)
      for (const r of range.getClientRects()) if (r.width && r.height) rects.push(r)
    }
    return rects
  }
  const lines = el => {
    const bands = []
    for (const rect of textRects(el)) {
      const band = bands.find(b => Math.min(b.bottom, rect.bottom) > Math.max(b.top, rect.top))
      if (band) { band.top = Math.max(band.top, rect.top); band.bottom = Math.min(band.bottom, rect.bottom) }
      else bands.push({top:rect.top,bottom:rect.bottom})
    }
    return bands.length
  }
  const isTextColumn = el => {
    const css = getComputedStyle(el)
    return css.display.includes('flex') && css.flexDirection === 'column'
  }
  const shortControlParts = el => {
    if (!el.matches('button') && [...el.children].some(child => child.matches('br'))) return []
    const column = isTextColumn(el) || [...el.querySelectorAll('*')].some(isTextColumn)
    if (!column) return [el]
    if ([...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) return [el]
    return [...el.children].filter(child => visible(child) && child.textContent.trim()
      && !child.matches('svg')).flatMap(shortControlParts)
  }
  const canvas = document.createElement('canvas').getContext('2d')
  const roots = [...document.querySelectorAll('[data-page-template]')].filter(visible)
  for (const root of roots) {
    const all = selector => [...root.querySelectorAll(selector)].filter(visible)
    const isList = root.dataset.pageTemplate === 'list'
    const folderScope = root.querySelector('[data-list-folders]')
    const hasFolders = folderScope?.dataset.listFolders === 'true'
    const heading = root.querySelector('[data-template-region="heading"],[data-template-region="header"]')
    const explanationBodies = [...root.querySelectorAll('[data-screen-explanation]')]
      .filter(el => el.closest('[data-page-template]') === root)
    const explanationToggles = heading ? [...heading.querySelectorAll('[data-screen-explanation-toggle]')].filter(visible) : []
    for (const panel of explanationBodies) {
      if (!panel.id || !explanationToggles.some(toggle => toggle.getAttribute('aria-controls') === panel.id)) {
        add('F4', panel, 'screen explanation body is missing its heading control')
      }
    }
    for (const toggle of explanationToggles) {
      if (toggle.getAttribute('aria-expanded') === 'true'
        && !explanationBodies.some(panel => panel.id && panel.id === toggle.getAttribute('aria-controls'))) {
        add('F4', toggle, 'open screen explanation control is missing its scoped body')
      }
    }
    inventory.push({
      board: root.dataset.designNode, template: root.dataset.pageTemplate, frame: root.dataset.heightMode,
      help: heading ? [...heading.querySelectorAll('button')].filter(visible).map(el => el.getAttribute('aria-label') || el.textContent.trim()) : [],
      explanationBodies: explanationBodies.length,
      explanationToggles: explanationToggles.length,
      folders: all('[data-template-region="folders"]').length,
      folderCapability: isList ? hasFolders : null,
      folderDots: all('[data-list-name] [data-folder-dot]').length,
      headingCreates: heading ? [...heading.querySelectorAll('a[href],button')].filter(el => visible(el) && /作る|登録する|追加する/.test(el.textContent)).length : 0,
      folderSelect: all('[data-toolbar-leading] button[aria-haspopup="listbox"]').filter(el => /フォルダ/.test(el.getAttribute('aria-label') ?? el.textContent)).length,
      folderCreate: all('[data-template-region="folders"] button').filter(el => /フォルダ.*追加/.test(el.textContent)).length,
      checks: all('tbody input[type="checkbox"]').length,
      rowMenus: all('tbody [data-row-menu]').length,
      rows: all('tbody tr:not(:has([colspan]))').map(el => el.getBoundingClientRect().height),
      pageSizes: all('[data-list-page-size]').length,
    })
    for (const el of all('[data-select-value],[data-list-number],[data-status-pill] > span,[data-kpi-detail] [role="note"],th,label,button:not(:has([data-list-name]))')) {
      if (el.closest('[data-list-name-cell]') || el.closest('tbody td') && !el.matches('[data-select-value],[data-list-number]') && !el.closest('[data-status-pill]')) continue
      if (el.closest('[data-kpi-number]')) continue
      const css = getComputedStyle(el)
      if (!el.textContent.trim() || css.display === 'contents') continue
      if (el.matches('[data-kpi-detail] [role="note"]')) {
        const oneLine = css.whiteSpace === 'nowrap' && css.overflowX === 'hidden' && css.textOverflow === 'ellipsis'
          && el.getBoundingClientRect().height <= parseFloat(css.lineHeight) + 1
        const single = el.closest('[data-kpi-detail-layout]')?.getAttribute('data-kpi-detail-layout') === 'single'
        if (oneLine && el.title.trim() === el.textContent.trim()) continue
      }
      const rects = textRects(el)
      if (!rects.length) continue
      const paintedWidth = Math.max(...rects.map(r=>r.right)) - Math.min(...rects.map(r=>r.left))
      const selectedValueContentWidth = el.getBoundingClientRect().width - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0)
      const selectedValueIsEllipsized = el.matches('[data-select-value]') && css.textOverflow === 'ellipsis' && paintedWidth > selectedValueContentWidth
      if (selectedValueIsEllipsized || paintedWidth > (el.clientWidth || el.getBoundingClientRect().width) - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0) + 1
        || rects.some(r => r.top < el.getBoundingClientRect().top + (parseFloat(css.paddingTop) || 0) - 1 || r.bottom > el.getBoundingClientRect().bottom - (parseFloat(css.paddingBottom) || 0) + 1)) add('F1', el, 'short text does not fit')
    }
    for (const el of all('input[type="search"]')) {
      if (el.value || !el.placeholder) continue
      const css = getComputedStyle(el); canvas.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
      if (canvas.measureText(el.placeholder).width > el.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0) + 1) add('F1', el, 'search placeholder does not fit')
    }
    for (const el of all('[data-list-date-time],[data-list-name],th,[data-status-pill],button,[data-page-title],[data-template-region="heading"] h1,[data-template-region="heading"] h2')) {
      // A control can contain a column of name/type or upload instructions.
      // Measure each label, including columns nested inside a horizontal row.
      const targets = el.matches('button') ? shortControlParts(el) : [el]
      for (const target of targets) if (lines(target) > 1) add('F2', target, 'short text wraps')
    }
    for (const el of all('[data-template-region="toolbar"] button:disabled,[data-template-region="toolbar"] input:disabled')) {
      const explained = el.title || (el.getAttribute('aria-describedby') || '').split(/\s+/).some(id => document.getElementById(id)?.textContent.trim())
      if (!explained && !el.closest('[aria-busy="true"]') && !/読み込|保存中|送信中|処理中/.test(el.textContent)) add('F8', el, 'disabled tool has no reason')
    }
    // A read-only sort description is still painted text. Control-only overlap
    // scans miss it when a shrinking filter group spills over its neighbour.
    for (const end of all('[data-template-region="toolbar"] [data-toolbar-trailing]')) {
      const toolbar = end.closest('[data-template-region="toolbar"]')
      const controls = [...toolbar.querySelectorAll('button,input,select,summary,a[href]')].filter(el => visible(el) && !end.contains(el))
      const walker = document.createTreeWalker(end, 4)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement
        if (!node.textContent.trim() || !visible(el) || el.closest('button,input,select,summary,a[href],svg')) continue
        const range = document.createRange(); range.selectNodeContents(node)
        if ([...range.getClientRects()].some(text => controls.some(control => {
          const rect = control.getBoundingClientRect()
          return Math.min(text.right, rect.right) - Math.max(text.left, rect.left) > 1
            && Math.min(text.bottom, rect.bottom) - Math.max(text.top, rect.top) > 1
        }))) add('F6', el, 'toolbar trailing text overlaps another control')
      }
    }
    for (const row of all('[class*="recentRow"]')) {
      const action = [...row.querySelectorAll('button')].find(el => visible(el) && el.textContent.trim() === '複製する')
      const metadata = action?.previousElementSibling
      if (!action || !visible(metadata)) continue
      const button = action.getBoundingClientRect()
      const touches = textRects(metadata).some(text => Math.min(text.bottom, button.bottom) > Math.max(text.top, button.top)
        && text.right >= button.left && text.left < button.right)
      if (touches) add('F6', metadata, 'recent broadcast metadata touches or overlaps the duplicate action')
    }

  }
  const listPages = roots.filter(root=>root.dataset.pageTemplate==='list').length
  const formPages = roots.filter(root=>root.dataset.pageTemplate==='create').length
  if (!listPages && !formPages) counts.F10 = null
  return { counts, findings, inventory, coverage: { pages: roots.length, listPages, formPages, notApplicable: listPages || formPages ? [] : ['F10: narrow list or form shape'], templates: [...new Set(roots.map(root=>root.dataset.pageTemplate))], DOM: ['F1', 'F2', 'F4', 'F6', 'F8'], sharedControlOwners: cssOwners.length, layoutAndValues: 'painted clipping and overlap; field errors'  } }
}
