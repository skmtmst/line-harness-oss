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
    if (heading) for (const chip of [...heading.querySelectorAll('button.v6-filter-chip')].filter(visible)) add('F5',chip,'heading action uses a filter chip instead of a shared button')
    for (const chip of all('button.v6-filter-chip')) if (/^アーカイブ済み(?:\s*\d+)?$/.test(chip.textContent.trim()) && !chip.querySelector('svg')) add('F4',chip,'archive filter is missing its shared icon')
    inventory.push({
      board: root.dataset.designNode, template: root.dataset.pageTemplate, frame: root.dataset.heightMode,
      help: heading ? [...heading.querySelectorAll('button')].filter(visible).map(el => el.getAttribute('aria-label') || el.textContent.trim()) : [],
      folders: all('[data-template-region="folders"]').length,
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
      if (paintedWidth > (el.clientWidth || el.getBoundingClientRect().width) - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0) + 1
        || el.scrollHeight > el.clientHeight + 1) add('F1', el, 'short text does not fit')
    }
    for (const el of all('input[type="search"]')) {
      if (el.value || !el.placeholder) continue
      const css = getComputedStyle(el); canvas.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
      if (canvas.measureText(el.placeholder).width > el.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0) + 1) add('F1', el, 'search placeholder does not fit')
    }
    for (const el of all('[data-list-date-time],[data-list-name],th,[data-design-node="xRvDB"],button')) {
      if (lines(el) > 1) add('F2', el, 'short text wraps')
    }
    for (const el of all('button,a[role="button"],[data-page-title]')) {
      if (/\d+\s+件表示/.test(el.textContent) && el.matches('button') && !el.querySelector('button')) add('F3', el, 'page size does not use the shared compact wording')
      if (/^(直す|編集|編集をする)$/.test(el.textContent.trim()) || /（任意）/.test(el.textContent) && el.matches('[data-page-title]')) add('F3', el, 'noncanonical action or optional title')
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
  if (!listPages) counts.F10 = null // This detector measures the narrow list shape, not other templates.
  return { counts, findings, inventory, coverage: { pages: roots.length, listPages, notApplicable: listPages ? [] : ['F10: narrow list shape'], templates: [...new Set(roots.map(root=>root.dataset.pageTemplate))], DOM: ['F1','F2','F3','F4', ...(cssOwners.length ? ['F5'] : []),'F7','F8','F9',...(listPages ? ['F10'] : [])], sharedControlOwners: cssOwners.length, sourceAudit: 'F5 styles and conditional states', layoutAndValues: 'F6' } }
}
