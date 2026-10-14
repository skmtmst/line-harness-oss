/** 単位や接頭辞を持つ1行欄も共通TextFieldの36pxを保つ。 */
export default function scanAffixedInputs() {
  const findings = [], root = document.querySelector('main') || document.body
  for (const frame of root.querySelectorAll('span[class*="affixed"]')) {
    const input = frame.querySelector('input')
    if (!input || frame === input || frame.className.includes('affixedControl')) continue
    let visible = true
    for (let parent = frame; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility !== 'visible' || parent.hidden || parent.hasAttribute('inert')) visible = false
      if (parent.matches('details:not([open])') && !parent.querySelector('summary')?.contains(frame)) visible = false
    }
    const height = frame.getBoundingClientRect().height
    if (!visible || !frame.getBoundingClientRect().width || !height) continue
    if (height < 36 - 1 / 64) findings.push({ kind: 'form-affixed-height', target: input.id ? '#' + CSS.escape(input.id) : 'input[aria-label="' + CSS.escape(input.getAttribute('aria-label') || '') + '"]', text: input.getAttribute('aria-label') || '接頭辞・単位つきの欄', measure: { shortage: 36 - height } })
  }
  return findings
}
