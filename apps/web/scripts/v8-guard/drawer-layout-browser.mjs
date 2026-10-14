export function scanDrawerLayout({ fixedActions = [], requiredIcons = [] } = {}) {
  const panel = document.querySelector('[data-m1-scope]')
  const inventory = [], findings = []
  if (!panel) return { inventory, findings }
  const box = panel.getBoundingClientRect()
  inventory.push({ kind: 'drawer-height', height: box.height, viewport: innerHeight })
  if (Math.abs(box.height - innerHeight) > 1 || Math.abs(box.top) > 1)
    findings.push({ pattern: 'F10', kind: 'drawer-viewport-height', height: box.height, top: box.top, expected: innerHeight })
  const footer = panel.querySelector(':scope > footer')
  if (fixedActions.length && !footer) findings.push({ pattern: 'F9', kind: 'drawer-footer-missing' })
  if (footer) {
    const css = getComputedStyle(panel), rect = footer.getBoundingClientRect()
    const expected = box.bottom - parseFloat(css.paddingBottom) - parseFloat(css.borderBottomWidth)
    inventory.push({ kind: 'drawer-footer-bottom', actual: rect.bottom, expected })
    if (Math.abs(rect.bottom - expected) > 1) findings.push({ pattern: 'F9', kind: 'drawer-footer-position', actual: rect.bottom, expected })
  }
  for (const name of fixedActions) {
    const action = [...(footer?.querySelectorAll('button,a') ?? [])].find(el => el.textContent.trim() === name)
    if (!action) { findings.push({ pattern: 'F4', kind: 'drawer-footer-action-missing', name }); continue }
    const rect = action.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    const visible = rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && (hit === action || action.contains(hit))
    inventory.push({ kind: 'drawer-footer-action', name, visible })
    if (!visible) findings.push({ pattern: 'F10', kind: 'drawer-footer-action-hidden', name })
  }
  for (const { name, icon } of requiredIcons) {
    const actions = [...panel.querySelectorAll('button,a')].filter(el => el.getAttribute('aria-label') === name || el.textContent.trim() === name)
    if (!actions.length || actions.some(el => !el.querySelector(`svg.${icon}`))) findings.push({ pattern: 'F9', kind: 'drawer-action-icon-missing', name, icon })
  }
  return { inventory, findings }
}
