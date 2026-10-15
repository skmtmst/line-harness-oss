export function scanDialogActions({ align, leadingAction, descriptionGap = false, naturalWidth = false, confirmPlacement } = {}) {
  const panel = document.querySelector('[data-m1-scope]')
  if (!panel) return { inventory: [], findings: [] }
  const findings = [], inventory = []
  const visible = el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
  const actions = panel.querySelector('[data-dialog-actions]')
  if (naturalWidth || confirmPlacement) {
    if (!actions) findings.push({ pattern: 'F9', kind: 'dialog-actions-missing' })
    else {
      const buttons = [...actions.querySelectorAll('button')].filter(visible)
      if (naturalWidth) for (const button of buttons) {
        const actual = button.getBoundingClientRect().width
        const sample = button.cloneNode(true)
        sample.removeAttribute('id')
        sample.setAttribute('aria-hidden', 'true')
        sample.style.cssText = 'position:absolute;visibility:hidden;width:max-content;min-width:0;max-width:none;flex:none;pointer-events:none'
        actions.append(sample)
        const expected = sample.getBoundingClientRect().width
        sample.remove()
        inventory.push({ kind: 'dialog-action-width', label: button.innerText.trim(), actual, expected })
        if (Math.abs(actual - expected) > 1) findings.push({ pattern: 'F6', kind: 'dialog-action-width', label: button.innerText.trim(), actual, expected })
      }
      if (confirmPlacement === 'start') {
        const box = actions.getBoundingClientRect(), css = getComputedStyle(actions)
        const left = box.left + parseFloat(css.paddingLeft), right = box.right - parseFloat(css.paddingRight)
        const cancel = buttons[0]?.getBoundingClientRect(), confirm = buttons[1]?.getBoundingClientRect()
        if (!cancel || !confirm || Math.abs(confirm.left - left) > 1 || Math.abs((cancel.left + cancel.right - left - right) / 2) > 1)
          findings.push({ pattern: 'F9', kind: 'dialog-delete-cancel-placement' })
      }
    }
  }
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
      if (align === 'start' && Math.abs(first.left - left) > 1) findings.push({ pattern: 'F9', kind: 'dialog-actions-start', difference: first.left - left })
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
