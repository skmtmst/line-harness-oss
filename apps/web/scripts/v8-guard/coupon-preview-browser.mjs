/** A phone may scroll its talk area; a coupon card must not hide its own action. */
export default function couponPreviewClipping() {
  const findings = []
  for (const card of document.querySelectorAll('[data-coupon-preview-state]')) {
    const rect = card.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    const style = getComputedStyle(card)
    if (!['hidden', 'clip'].includes(style.overflowY)) continue
    for (const button of card.querySelectorAll('button')) {
      const action = button.getBoundingClientRect()
      if (action.width && action.height && (action.bottom > rect.bottom + 1 || action.top < rect.top - 1)) {
        findings.push({ kind: 'coupon-action-clipped', state: card.getAttribute('data-coupon-preview-state'), excess: Math.ceil(Math.max(action.bottom - rect.bottom, rect.top - action.top)), action: button.textContent.trim() })
      }
    }
  }
  const form = document.querySelector('#coupon-basics')?.closest('[data-design-part="card"]')
  if (form) {
    const row = form.querySelector('[data-form-row="media-fields"]')
    const image = form.querySelector('[data-frame-part="image-frame"], [data-media-slot]')
    const title = form.querySelector('#te-coupon-title')
    if (row && image && title) {
      const a = image.getBoundingClientRect(), b = title.getBoundingClientRect()
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0
      if (Math.abs(a.top - b.top) < 60 && b.left - a.right > gap + 2) findings.push({ kind: 'coupon-media-gap', gap: b.left - a.right })
    }
    for (const row of document.querySelector('#coupon-benefit')?.closest('[data-design-part="card"]')?.querySelectorAll('[data-form-row="compact"]') ?? []) {
      const columns = [...row.children].filter(e => e.getBoundingClientRect().width)
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0
      for (let i = 1; i < columns.length; i++) {
        const a = columns[i-1].getBoundingClientRect(), b = columns[i].getBoundingClientRect()
        if (Math.abs(a.top-b.top) < 2 && b.left-a.right > gap+2) findings.push({ kind: 'coupon-compact-gap', gap: b.left-a.right })
      }
    }
    for (const input of document.querySelector('#coupon-benefit')?.closest('[data-design-part="card"]')?.querySelectorAll('input[type="number"]') ?? []) {
      const rect = input.getBoundingClientRect()
      const short = input.closest('[data-short]')
      if (rect.width && (!short || short.getBoundingClientRect().width > 180)) findings.push({kind:'coupon-number-wide', id:input.id, width:rect.width})
    }
  }
  return findings
}
