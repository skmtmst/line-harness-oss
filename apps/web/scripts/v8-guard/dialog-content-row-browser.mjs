export function scanDialogContentRows({ expected = 0, muted = 0 } = {}) {
  const scope = document.querySelector('[data-m1-scope]') || document
  const visible = element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden' }
  const rows = [...scope.querySelectorAll('[data-dialog-content-row]')].filter(visible)
  const findings = [], inventory = []
  if (rows.length !== expected) findings.push({ pattern: 'F4', kind: 'dialog-content-row-count', expected, actual: rows.length })
  if (rows.filter(row => row.dataset.tone === 'muted').length !== muted) findings.push({ pattern: 'F4', kind: 'dialog-muted-row-count' })
  for (const row of rows) {
    const style = getComputedStyle(row), rect = row.getBoundingClientRect(), parent = row.parentElement.getBoundingClientRect()
    const filled = row.dataset.tone === 'muted'
    const transparent = style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent'
    const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1
    inventory.push({ text: row.innerText, width: rect.width, height: rect.height, outline: hasOutline, muted: filled, background: style.backgroundColor })
    if (!hasOutline) findings.push({ pattern: 'F6', kind: 'dialog-row-outline-missing' })
    if (filled === transparent) findings.push({ pattern: 'F3', kind: 'dialog-row-surface' })
    if (rect.right > parent.right + 1 || rect.left < parent.left - 1) findings.push({ pattern: 'F10', kind: 'dialog-row-overflow' })
    if (row.dataset.size === 'account') {
      const action = row.querySelector('[data-row-menu]')
      const gap = action ? rect.right - action.getBoundingClientRect().right : null
      inventory.push({ kind: 'account-action-edge', gap })
      if (gap === null || gap < 11.5) findings.push({ pattern: 'F6', kind: 'dialog-account-action-edge', gap, minimum: 12 })
    }
    const label = row.querySelector('label')
    if (label && getComputedStyle(label).outlineStyle !== 'none') findings.push({ pattern: 'F6', kind: 'dialog-row-double-outline' })
  }
  return { findings, inventory }
}
