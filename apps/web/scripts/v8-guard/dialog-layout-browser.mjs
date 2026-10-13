export function scanDialogAudit({ expectedWidth, fullForm = false, requiredAction, compactBody = false } = {}) {
  const panel = document.querySelector('[data-m1-scope]')
  if (!panel) return { inventory: [], findings: [] }
  const rect = panel.getBoundingClientRect()
  const inventory = [{ kind: 'panel', width: rect.width, height: rect.height }]
  const findings = []
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
