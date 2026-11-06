/** 窓の題・状態、設定ナビ、手順の焦点、表の状態セルを実寸で調べる。 */
export function scanPatrolLayout(kind) {
  const findings = []
  const visible = node => node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden'
  if (kind === 'dialog') for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    const title = dialog.querySelector('h2')
    if (!title) continue
    const a = title.getBoundingClientRect()
    const badges = title.parentElement.querySelectorAll('[data-tone]')
    if (badges.length !== 1) findings.push({ kind: 'missing-dialog-title-badge', count: badges.length })
    for (const badge of badges) {
      if (!visible(badge)) continue
      const b = badge.getBoundingClientRect()
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)) findings.push({ kind: 'dialog-title-badge-overlap' })
    }
  }
  if (kind === 'aggregation') {
    const failed = [...document.querySelectorAll('[data-aggregation-state="failed"]')].filter(visible)
    const reason = failed[0]?.querySelector('p')?.textContent.trim()
    if (!reason) findings.push({ kind: 'missing-aggregation-error' })
    else {
      const copies = [...document.querySelectorAll('main p, main [data-list-state="error"] h3')].filter(node => visible(node) && node.textContent.trim() === reason)
      if (copies.length !== 1) findings.push({ kind: 'duplicate-aggregation-error', copies: copies.length })
    }
  }
  if (kind === 'settings') {
    const navs = [...document.querySelectorAll('[data-settings-nav]')].filter(visible)
    if (document.querySelector('[data-settings-split]') && navs.length !== 1) findings.push({ kind: 'missing-settings-navigation', count: navs.length })
    for (const nav of navs) {
      const list = nav.querySelector('ul')
      if (getComputedStyle(nav).flexDirection !== 'column' || (list && getComputedStyle(list).flexDirection !== 'column')) findings.push({ kind: 'settings-navigation-band' })
      const side = nav.closest('[data-template-region="navigation"]') ?? nav
      const body = side.nextElementSibling
      if (!body) findings.push({ kind: 'missing-settings-body' })
      else if (body.getBoundingClientRect().left < side.getBoundingClientRect().right - 1) findings.push({ kind: 'settings-navigation-above-content' })
    }
    const main = document.querySelector('main')
    if (!main || main.scrollWidth > main.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1) findings.push({ kind: 'settings-horizontal-overflow' })
    for (const node of document.querySelectorAll('main table, main [role="table"], main [data-template-region="preview"]')) {
      if (visible(node) && node.getBoundingClientRect().right > innerWidth + 1) findings.push({ kind: 'settings-right-edge-overflow' })
    }
    for (const frame of document.querySelectorAll('[data-page-template]')) if (frame.getBoundingClientRect().width < 1100) {
      for (const preview of frame.querySelectorAll('[data-template-region="preview"], aside[aria-label="プレビュー"]')) if (visible(preview)) findings.push({ kind: 'settings-preview-not-collapsed' })
    }
  }
  if (kind === 'focus') {
    const panel = document.querySelector('main form [data-step-content]')
    const heading = panel?.querySelector('[data-step-heading]')
    if (!heading || !/^H[23]$/.test(heading.tagName) || heading.tabIndex !== -1 || document.activeElement !== heading) findings.push({ kind: 'step-heading-focus-missing' })
    else {
      const style = getComputedStyle(heading)
      if (!heading.matches(':focus-visible')) findings.push({ kind: 'step-keyboard-focus-missing' })
      if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) <= 0) findings.push({ kind: 'step-heading-focus-ring-missing' })
      const range = document.createRange(); range.selectNodeContents(heading)
      const bounds = heading.getBoundingClientRect(), text = range.getBoundingClientRect()
      if (bounds.width > text.width + 2 || bounds.height > text.height + 8) findings.push({ kind: 'step-heading-focus-ring-too-large', bounds: { width: bounds.width, height: bounds.height }, text: { width: text.width, height: text.height } })
    }
  }
  if (kind === 'status') {
    const table = [...document.querySelectorAll('table')].find(table => [...table.querySelectorAll('th')].some(cell => cell.textContent.trim() === '状態'))
    const index = table ? [...table.querySelectorAll('thead th')].findIndex(cell => cell.textContent.trim() === '状態') : -1
    const rows = [...(table?.querySelectorAll('tbody tr[data-row-id]') ?? [])]
    if (index < 0 || !rows.length) findings.push({ kind: 'missing-status-table' })
    for (const row of rows) if (!row.children[index]?.textContent.trim()) findings.push({ kind: 'empty-status-cell', row: row.getAttribute('data-row-id') })
  }
  return findings
}
