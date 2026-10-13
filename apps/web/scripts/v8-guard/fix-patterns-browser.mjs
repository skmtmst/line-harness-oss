/** B-267/268: rendered evidence. Presence is separate from defects; API/rights
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
  const shortTextTargets = el => {
    if (!el.matches('button') && [...el.children].some(child => child.matches('br'))) return []
    const css = getComputedStyle(el)
    const column = css.display.includes('flex') && css.flexDirection === 'column'
    const children = [...el.children].filter(child => visible(child) && child.textContent.trim() && !child.matches('svg'))
    if (!children.length || [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) return [el]
    const nestedColumn = css.display.includes('flex') && children.some(child => {
      const style = getComputedStyle(child)
      return style.display.includes('flex') && style.flexDirection === 'column'
    })
    if (!column && !nestedColumn) return [el]
    return children.flatMap(shortTextTargets)
  }
  const canvas = document.createElement('canvas').getContext('2d')
  const roots = [...document.querySelectorAll('[data-page-template]')].filter(visible)
  for (const root of roots) {
    const all = selector => [...root.querySelectorAll(selector)].filter(visible)
    // Z1: text can be one line while its avatar has moved above it.
    for (const cell of all('tbody td,[role="row"] [role="cell"]')) {
      const avatar = [...cell.querySelectorAll('[data-avatar],[aria-hidden="true"]')].find(el => {
        const r = el.getBoundingClientRect(), radius = getComputedStyle(el).borderRadius
        return visible(el) && !el.matches('svg') && (el.hasAttribute('data-avatar') || r.width <= 56 && r.height <= 56 && (radius === '50%' || parseFloat(radius) >= Math.min(r.width, r.height) / 2))
      })
      if (!avatar) continue
      const face = avatar.getBoundingClientRect()
      const names = textRects(cell, avatar)
      if (names.length && !names.some(r => Math.min(r.bottom, face.bottom) > Math.max(r.top, face.top))) add('F2', cell, 'avatar and person name occupy separate vertical rows')
    }
    // Z3: canonical content owns an inset, whereas a full-bleed list table does not.
    for (const content of all('[data-template-region="content"]')) {
      if (content.parentElement?.closest('[data-template-region="content"]')) continue
      const children = [...content.children].filter(visible)
      const inset = parseFloat(getComputedStyle(content).paddingRight) || 0
      const nestedContent = children.find(el => el.matches('[data-template-region="content"]'))
      const body = nestedContent ?? (root.dataset.pageTemplate === 'settings' || inset > 0 ? content : null)
      if (!body) continue
      const blocks = [...body.children].filter(el => visible(el) && !el.matches('[role="dialog"],[role="menu"]'))
      if (!blocks.length) continue
      const gap = root.getBoundingClientRect().right - Math.max(...blocks.map(el => el.getBoundingClientRect().right))
      if (gap < 8) add('F6', body, 'content right edge is less than 8px from the white page edge')
    }
    const isList = root.dataset.pageTemplate === 'list'
    if (isList && !root.hasAttribute('data-list-skeleton') && !root.querySelector('[data-list-skeleton]')) add('F4', root, 'list template is missing its shared standard and audit scope')
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
    const body = root.querySelector('[data-list-folders]')
    const hasFolders = body ? body.dataset.listFolders === 'true' : !!root.querySelector('[data-template-region="folders"], [data-toolbar-leading] [aria-label="フォルダ"]')
    if (isList && !hasFolders) {
      for (const el of all('[data-template-region="toolbar"] a[href], [data-template-region="toolbar"] button')) {
        if (/作る|登録する|追加する/.test(el.textContent) && !el.hasAttribute('aria-haspopup')) add('F9',el,'folderless list creation belongs in heading actions')
      }
      for (const el of all('[data-list-name] [data-folder-dot]')) add('F9',el,'folderless list name has a folder dot')
    }
    if (heading) {
      const controls = [...heading.querySelectorAll('button')].filter(visible)
      const explanation = controls.find(el => /この画面の説明/.test(el.textContent))
      const help = controls.find(el => /^[?？]$/.test(el.textContent.trim()))
      if (help && explanation && (help.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_PRECEDING)) add('F3',heading,'heading help must precede screen explanation')
    }
    if (heading) for (const chip of [...heading.querySelectorAll('button.v6-filter-chip')].filter(visible)) add('F5',chip,'heading action uses a filter chip instead of a shared button')
    for (const chip of all('button.v6-filter-chip')) if (/^アーカイブ済み(?:\s*\d+)?$/.test(chip.textContent.trim()) && !chip.querySelector('svg')) add('F4',chip,'archive filter is missing its shared icon')
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
    for (const el of all('[data-select-value],[data-list-number],[data-design-node="xRvDB"] > span,[data-kpi-detail] [role="note"],th,label,button:not(:has([data-list-name]))')) {
      if (el.closest('[data-list-name-cell]') || el.closest('tbody td') && !el.matches('[data-select-value],[data-list-number]') && !el.closest('[data-design-node="xRvDB"]')) continue
      if (el.closest('[data-kpi-number]')) continue
      const css = getComputedStyle(el)
      if (!el.textContent.trim() || css.display === 'contents') continue
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
    for (const el of all('[data-list-date-time],[data-list-name],th,[data-design-node="xRvDB"],button')) {
      // A column of title/instructions is a composite control. Audit each
      // short label; explicit line breaks in instructions are intentional.
      const targets = el.matches('button') ? shortTextTargets(el) : [el]
      for (const target of targets) if (lines(target) > 1) add('F2', target, 'short text wraps')
    }
    for (const el of all('button,a[role="button"],[data-page-title]')) {
      if (/\d+\s+件表示/.test(el.textContent) && el.matches('button') && !el.querySelector('button')) add('F3', el, 'page size does not use the shared compact wording')
      if (/^(直す|編集|編集をする)$/.test(el.textContent.trim()) || /（任意）/.test(el.textContent) && el.matches('[data-page-title]')) add('F3', el, 'noncanonical action or optional title')
    }
    for (const el of all('[data-pagination] > span,[data-pagination-summary],span[class*="pager"],p[class*="pager"]')) {
      if (/(?:[\d,]+|—)\s+(?:件|人)中/.test(el.textContent)) add('F3', el, 'pagination count contains spaced handwritten units')
    }
    for (const el of all('[data-unknown-value],td:not([data-list-name-cell]) [data-design-node="xRvDB"],td:not([data-list-name-cell]),[data-kpi-detail] [role="note"]')) {
      if (el.matches('td') && el.querySelector('[data-unknown-value]')) continue
      if ((el.hasAttribute('data-unknown-value') || /^(?:種類を確認.*|確認できません|不明|未取得|[（(]未取得[）)])$/.test(el.textContent.trim())
        || /—\s*[（(]未取得[）)]/.test(el.textContent)) && !['—', '未設定', 'なし'].includes(el.textContent.trim())) add('F7', el, 'unknown value is not one of the three canonical values')
    }
    for (const folder of all('[data-template-region="folders"]')) {
      const choices = [...folder.querySelectorAll('nav button')].filter(el=>visible(el) && !el.hasAttribute('data-row-menu') && el.getAttribute('aria-haspopup') !== 'menu')
      if (choices.length <= 1) add('F8',folder,'folder rail has no choice to filter by')
    }
    for (const el of all('[data-list-sort]')) {
      const value = el.querySelector('[data-select-value]')
      if (!visible(value) || !/^並び[：:].+/.test(value.textContent.trim())) add('F8', el, 'sort has no visible current value')
    }
    const owned = el => !!el && [...el.classList].some(cls => cssOwners.some(name => cls === name || cls.startsWith(`${name}_`)))
    if (cssOwners.length) for (const el of all('[data-template-region="toolbar"] > p')) {
      if (!owned(el)) add('F5', el, 'toolbar explanation has a page CSS owner instead of shared parts')
    }
    if (cssOwners.length) for (const el of all('[data-template-region="toolbar"] button,[data-template-region="toolbar"] input,[data-template-region="toolbar"] select,[data-template-region="toolbar"] summary')) {
      if (owned(el) || el.matches('summary') && owned(el.closest('[data-toolbar-optional]'))
        || el.matches('input[type="checkbox"],input[type="radio"]') && owned(el.closest('label'))) continue
      add('F5', el, 'tool has no shared or template CSS owner')
    }
    if (cssOwners.length) for (const el of all('[data-row-menu]')) {
      if (!owned(el) || [...el.classList].some(cls => cls.includes('__') && !cssOwners.some(name => cls.startsWith(`${name}_`)))) {
        add('F5', el, 'row menu shape has a page CSS owner instead of shared props')
      }
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
    for (const el of all('[data-row-menu]')) if (el.closest('[data-kpi-strip]')) add('F9', el, 'row menu in KPI band')
    for (const cell of all('[data-list-action-cell]')) {
      const tools = [...cell.querySelectorAll('button,a[role="button"]')].filter(visible)
      if (!tools.length) continue
      const right = Math.max(...tools.map(el=>el.getBoundingClientRect().right))
      const css = getComputedStyle(cell), expected = cell.getBoundingClientRect().right - (parseFloat(css.paddingRight)||0) - (parseFloat(css.borderRightWidth)||0)
      if (expected-right > 1) add('F9',cell,'row actions do not occupy the shared right edge')
    }
    for (const el of all('[data-list-name-cell] [data-design-node="xRvDB"]')) add('F9', el, 'state is in name column')
    if (isList && root.getBoundingClientRect().width < 1100) {
      // Measure the template's whole tool region. Linked create actions and
      // native selects used to fall outside the button-only inner-toolbar scan.
      for (const toolbar of (all('[data-template-region="toolbar"]').length ? all('[data-template-region="toolbar"]') : all('[data-shared-part="list-toolbar"]').filter(el=>!el.parentElement.closest('[data-shared-part="list-toolbar"]')))) {
        const controls = [...toolbar.querySelectorAll('button,input,summary,select,a[href]')].filter(el => visible(el)
          && !el.closest('[data-toolbar-optional][data-collapsed] [data-toolbar-optional-content]')
          && !el.closest('[data-design-part="notice"],[data-shared-part="notice"],[role="status"],[role="alert"],[data-explanation]'))
        const rows = []
        for (const el of controls.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)) {
          const rect = el.getBoundingClientRect(), row = rows.find(r => Math.min(r.bottom,rect.bottom)>Math.max(r.top,rect.top))
          if (row) { row.top=Math.max(row.top,rect.top);row.bottom=Math.min(row.bottom,rect.bottom);row.controls.push(el) }
          else rows.push({top:rect.top,bottom:rect.bottom,controls:[el]})
        }
        if (rows.length > 2 || toolbar.querySelector('[data-list-page-size]') && rows.length !== 2) add('F10', toolbar, `narrow list has ${rows.length} tool rows instead of two`)
        for (const row of rows) if (row.controls.length === 1 && row.controls[0].matches('select,[aria-haspopup="listbox"]')) add('F10',row.controls[0],'narrow list has an isolated select row')
        for (const el of controls.filter(el => el.closest('[data-toolbar-leading]') && el.matches('a,button:not([aria-haspopup])') && /作る|登録する|追加する/.test(el.textContent))) {
          const rects = textRects(el), css = getComputedStyle(el)
          if (!rects.length) continue
          const textWidth = Math.max(...rects.map(r=>r.right))-Math.min(...rects.map(r=>r.left))
          const icons = [...el.querySelectorAll('svg')].filter(visible)
          const intrinsic = textWidth + icons.reduce((sum,icon)=>sum+icon.getBoundingClientRect().width,0)
            + icons.length * (parseFloat(css.columnGap)||0) + (parseFloat(css.paddingLeft)||0) + (parseFloat(css.paddingRight)||0)
            + (parseFloat(css.borderLeftWidth)||0) + (parseFloat(css.borderRightWidth)||0)
          if (el.getBoundingClientRect().width > intrinsic + 1) add('F10',el,'create action stretches beyond its text, icon and shared padding')
        }
      }

      for (const folder of all('[data-template-region="folders"]')) add('F10', folder, 'folder column remains in narrow list')
      for (const count of all('[data-list-page-size]')) {
        const toolbar = count.closest('[data-template-region="toolbar"]')
        if (!toolbar) continue
        const controls = [...toolbar.querySelectorAll('input,button')].filter(visible)
        const c = count.getBoundingClientRect(), bottom = Math.max(...controls.map(el => el.getBoundingClientRect().bottom))
        const right = Math.max(...controls.map(el => el.getBoundingClientRect().right))
        if (c.bottom < bottom - 1 || c.right < right - 1) add('F9', count, 'page size is not last row right')
      }
    }
  }
  const listPages = roots.filter(root=>root.dataset.pageTemplate==='list').length
  const formPages = roots.filter(root=>root.dataset.pageTemplate==='create').length
  if (!listPages && !formPages) counts.F10 = null
  return { counts, findings, inventory, coverage: { pages: roots.length, listPages, formPages, notApplicable: listPages || formPages ? [] : ['F10: narrow list or form shape'], templates: [...new Set(roots.map(root=>root.dataset.pageTemplate))], DOM: ['F1','F2','F3','F4', ...(cssOwners.length ? ['F5'] : []),'F7','F8','F9',...(listPages || formPages ? ['F10'] : [])], sharedControlOwners: cssOwners.length, sourceAudit: 'F5 styles and conditional states', layoutAndValues: 'F6; form geometry: form-rules and form-columns' } }
}
