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
  return findings
}
