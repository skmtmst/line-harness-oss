export function scanDialogActions({ align, leadingAction, descriptionGap = false } = {}) {
  const panel = document.querySelector('[data-m1-scope]')
  if (!panel) return { inventory: [], findings: [] }
  const findings = [], inventory = []
  const visible = el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
  const actions = panel.querySelector('[data-dialog-actions]')
  if (align || leadingAction) {
    const buttons = actions ? [...actions.querySelectorAll('button')].filter(visible) : []
    if (!buttons.length) findings.push({ pattern: 'F9', kind: 'dialog-actions-missing' })
    else {
      const box = actions.getBoundingClientRect(), css = getComputedStyle(actions)
      const left = box.left + parseFloat(css.paddingLeft), right = box.right - parseFloat(css.paddingRight)
      const first = buttons[0].getBoundingClientRect(), last = buttons.at(-1).getBoundingClientRect()
      const centerDifference = Math.abs((first.left + last.right - left - right) / 2)
      inventory.push({ kind: 'dialog-actions', left, right, centerDifference })
      if (align === 'center' && centerDifference > 1) findings.push({ pattern: 'F9', kind: 'dialog-actions-center', centerDifference })
      if (leadingAction) {
        const lead = buttons.find(el => el.innerText.trim() === leadingAction)
        if (!lead || Math.abs(lead.getBoundingClientRect().left - left) > 1 || Math.abs(last.right - right) > 1)
          findings.push({ pattern: 'F9', kind: 'dialog-actions-split', leadingAction })
      }
    }
  }
  if (descriptionGap) {
    const title = panel.querySelector('h2'), description = (panel.getAttribute('aria-describedby') ?? '').split(/\s+/).map(id => document.getElementById(id)).find(el => el && panel.contains(el))
    if (title && description && panel.contains(description)) {
      const gap = description.getBoundingClientRect().top - title.getBoundingClientRect().bottom
      inventory.push({ kind: 'dialog-title-description', gap })
      if (gap > 8) findings.push({ pattern: 'F6', kind: 'dialog-title-description-gap', gap })
    } else findings.push({ pattern: 'F4', kind: 'dialog-title-description-missing' })
  }
  return { inventory, findings }
}
