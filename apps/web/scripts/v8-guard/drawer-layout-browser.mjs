export function scanDrawerLayout({ fixedActions = [] } = {}) {
  const panel = document.querySelector('[data-m1-scope]')
  const inventory = [], findings = []
  if (!panel) return { inventory, findings }
  const box = panel.getBoundingClientRect()
  inventory.push({ kind: 'drawer-height', height: box.height, viewport: innerHeight })
  if (box.top < -1 || box.bottom > innerHeight + 1 || box.left < -1 || box.right > innerWidth + 1)
    findings.push({ pattern: 'F10', kind: 'drawer-viewport-bounds', rect: box.toJSON() })
  const footer = panel.querySelector(':scope > footer')
  if (fixedActions.length && !footer) findings.push({ pattern: 'F9', kind: 'drawer-footer-missing' })
  for (const name of fixedActions) {
    const action = [...(footer?.querySelectorAll('button,a') ?? [])].find(el => el.textContent.trim() === name)
    if (!action) { findings.push({ pattern: 'F4', kind: 'drawer-footer-action-missing', name }); continue }
    const rect = action.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    const visible = rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && (hit === action || action.contains(hit))
    inventory.push({ kind: 'drawer-footer-action', name, visible })
    if (!visible) findings.push({ pattern: 'F10', kind: 'drawer-footer-action-hidden', name })
  }
  return { inventory, findings }
}
