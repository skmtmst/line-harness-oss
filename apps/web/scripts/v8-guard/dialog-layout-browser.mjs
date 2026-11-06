export function scanDialogAudit({ viewportFit = false, fixedActions = [] } = {}) {
  const panel = document.querySelector('[data-m1-scope]')
  if (!panel) return { inventory: [], findings: [] }
  const rect = panel.getBoundingClientRect()
  const inventory = [{ kind: 'panel', width: rect.width, height: rect.height }]
  const findings = []
  if (viewportFit) {
    const excess = Math.max(-rect.top, rect.bottom - innerHeight, -rect.left, rect.right - innerWidth, 0)
    inventory.push({ kind: 'dialog-viewport-bounds', excess, rect: rect.toJSON() })
    if (excess > 1) findings.push({ pattern: 'F10', kind: 'dialog-viewport-bounds', excess })
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
  return { inventory, findings }
}
