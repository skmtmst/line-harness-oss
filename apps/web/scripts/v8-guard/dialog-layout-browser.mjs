export function scanDialogAudit({ expectedWidth, expectedTop, fullForm = false, requiredAction, fixedActions = [], pickerControls = false, compactBody = false, choices = false, plainUsage = false, columnSettings = false, scoreHistory = false } = {}) {
  const panel = document.querySelector('[data-m1-scope]')
  if (!panel) return { inventory: [], findings: [] }
  const rect = panel.getBoundingClientRect()
  const inventory = [{ kind: 'panel', width: rect.width, height: rect.height }]
  const findings = []
  if (Number.isFinite(expectedTop)) {
    inventory.push({ kind: 'dialog-top', actual: rect.top, expected: expectedTop })
    if (Math.abs(rect.top - expectedTop) > 1) findings.push({ pattern: 'F6', kind: 'dialog-top', actual: rect.top, expected: expectedTop })
  }
  if (pickerControls) {
    const search = panel.querySelector('input[type="search"]')?.parentElement
    if (!search) findings.push({ pattern: 'F4', kind: 'dialog-search-missing' })
    else {
      const height = search.getBoundingClientRect().height
      inventory.push({ kind: 'picker-search', height })
      if (Math.abs(height - 36) > 1) findings.push({ pattern: 'F6', kind: 'dialog-search-height', height, expected: 36 })
    }
  }
  for (const name of fixedActions) {
    const button = [...panel.querySelectorAll('button')].find(el => el.innerText.trim() === name)
    if (!button) { findings.push({ pattern: 'F4', kind: 'dialog-fixed-action-missing', name }); continue }
    const box = button.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    const visible = box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth && (hit === button || button.contains(hit))
    inventory.push({ kind: 'fixed-action', name, visible, rect: box.toJSON() })
    if (!visible) findings.push({ pattern: 'F10', kind: 'dialog-fixed-action-hidden', name })
  }
  if (choices) {
    const grid = panel.querySelector('[data-dialog-choice-cards]')
    if (!grid) findings.push({ pattern: 'F4', kind: 'dialog-choice-grid-missing' })
    else for (const link of grid.querySelectorAll('a[href]')) {
      const color = getComputedStyle(link).backgroundColor
      const image = getComputedStyle(link).backgroundImage
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const alpha = context.getImageData(0, 0, 1, 1).data[3]
      inventory.push({ kind: 'choice-link', text: link.textContent.trim(), color, image, alpha })
      if (alpha > 0 || image !== 'none') findings.push({ pattern: 'F6', kind: 'dialog-choice-label-background', color, image })
    }
  }
  if (plainUsage) {
    const table = panel.querySelector('table[aria-label="使っている所"]')
    if (!table) findings.push({ pattern: 'F4', kind: 'dialog-usage-table-missing' })
    else {
      const dots = table.querySelectorAll('[data-folder-dot]').length
      inventory.push({ kind: 'usage-table', folderDots: dots })
      if (dots) findings.push({ pattern: 'F9', kind: 'dialog-usage-folder-dots', count: dots })
      for (const link of table.querySelectorAll('a[target="_blank"]')) {
        const icons = link.querySelectorAll('svg').length
        inventory.push({ kind: 'usage-external-action', icons })
        if (icons !== 1) findings.push({ pattern: 'F9', kind: 'dialog-usage-external-icons', count: icons })
      }
    }
  }
  if (columnSettings) {
    const fixed = panel.querySelector('[data-fixed-display-name]')
    const selected = panel.querySelector('[data-presentation="columns"] [aria-label="選択した列"]')
    if (!fixed || !selected || !selected.contains(fixed)) findings.push({ pattern: 'F4', kind: 'display-fixed-name-missing' })
    if (selected) {
      const css = getComputedStyle(selected)
      const framed = css.boxShadow !== 'none' || (css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0) || parseFloat(css.borderTopWidth) > 0
      inventory.push({ kind: 'selected-columns', framed })
      if (!framed) findings.push({ pattern: 'F6', kind: 'display-selected-frame-missing' })
    }
    for (const group of panel.querySelectorAll('[role="group"][aria-label$="の追加できる列"]')) {
      const columns = getComputedStyle(group).gridTemplateColumns.split(' ').filter(Boolean)
      if (columns.length !== 2) findings.push({ pattern: 'F10', kind: 'display-available-columns', actual: columns.length, expected: 2 })
    }
  }
  if (scoreHistory) {
    for (const delta of panel.querySelectorAll('[data-score-delta]')) {
      const sign = delta.getAttribute('data-score-delta')
      const token = sign === 'positive' ? '--color-accent-deep' : sign === 'negative' ? '--color-warning' : null
      if (!token) continue
      const probe = document.createElement('span')
      probe.style.color = `var(${token})`
      panel.append(probe)
      const expected = getComputedStyle(probe).color
      probe.remove()
      const actual = getComputedStyle(delta).color
      inventory.push({ kind: 'score-history-delta', sign, actual, expected })
      if (actual !== expected) findings.push({ pattern: 'F6', kind: 'score-history-tone', sign, actual, expected })
    }
  }
  const descriptionBand = panel.getAttribute('data-description-band')
  if (descriptionBand === 'danger') {
    const description = (panel.getAttribute('aria-describedby') ?? '').split(/\s+/).map(id => document.getElementById(id)).find(el => el && panel.contains(el))
    if (description) {
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-danger)'
      panel.append(probe)
      const expectedColor = getComputedStyle(probe).color
      probe.remove()
      const css = getComputedStyle(description)
      const actual = { color: css.color, fontSize: parseFloat(css.fontSize), lineHeight: parseFloat(css.lineHeight) }
      inventory.push({ kind: 'description-band', band: descriptionBand, ...actual, expectedColor })
      if (actual.color !== expectedColor || actual.fontSize !== 11 || actual.lineHeight !== 17) {
        findings.push({ pattern: 'F6', kind: 'dialog-description-band', band: descriptionBand, ...actual, expectedColor })
      }
    }
  }
  if (requiredAction && ![...panel.querySelectorAll('button,[role="menuitem"]')].some(el => el.innerText?.trim() === requiredAction)) {
    findings.push({ pattern: 'F8', kind: 'dialog-action-label', expected: requiredAction })
  }
  if (Number.isFinite(expectedWidth) && Math.abs(rect.width - Math.min(expectedWidth, innerWidth - 32)) > 1) {
    findings.push({ pattern: 'F6', kind: 'dialog-width', actual: rect.width, expected: Math.min(expectedWidth, innerWidth - 32) })
  }
  if (compactBody) {
    const header = [...panel.children].find(el => el.querySelector('h2'))
    const body = [...panel.children].find(el => el !== header && el.querySelector('input:not([type="hidden"]),textarea'))
    if (header && body) {
      const description = (panel.getAttribute('aria-describedby') ?? '').split(/\s+/).map(id => document.getElementById(id)).find(el => el && panel.contains(el))
      const lead = description ?? header
      const gap = body.getBoundingClientRect().top + parseFloat(getComputedStyle(body).paddingTop) - lead.getBoundingClientRect().bottom
      inventory.push({ kind: 'header-body-gap', gap })
      if (gap > 17) findings.push({ pattern: 'F6', kind: 'dialog-header-body-gap', gap, maximum: 16 })
    }
  }
  if (fullForm) {
    for (const control of panel.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]),textarea')) {
      const field = control.closest('[data-form-requirement]') ?? control.parentElement
      const content = [...panel.children].find(el => el.contains(control))
      if (!content || !field) continue
      const c = content.getBoundingClientRect()
      const css = getComputedStyle(content)
      const available = c.width - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
      const width = control.getBoundingClientRect().width
      if (width === 0) continue
      inventory.push({ kind: 'input', width, available })
      if (available - width > 1) findings.push({ pattern: 'F6', kind: 'dialog-input-width', width, available })
    }
  }
  return { inventory, findings }
}
