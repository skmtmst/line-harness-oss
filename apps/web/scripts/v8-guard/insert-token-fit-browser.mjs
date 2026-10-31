/** 差し込み札の自然幅で、本文の欄や一覧の吹き出しを押し広げない。 */
export default function scanInsertTokenFit() {
  const findings = []
  for (const chip of document.querySelectorAll('[data-token]')) {
    const box = chip.getBoundingClientRect(), css = getComputedStyle(chip)
    if (!box.width || !box.height || css.visibility === 'hidden' || chip.closest('[hidden],[inert]')) continue
    let host = chip.parentElement
    while (host && !host.matches('[contenteditable]') && getComputedStyle(host).display === 'inline') host = host.parentElement
    if (!host) continue
    const style = getComputedStyle(host), n = value => parseFloat(value) || 0
    const available = host.clientWidth - n(style.paddingLeft) - n(style.paddingRight)
    if (host.clientWidth <= 0) continue
    if (box.width > available) findings.push({ kind: 'insert-token-overflow', target: '[data-token]', text: chip.textContent.trim(), measure: { width: box.width, available } })
  }
  return findings
}
