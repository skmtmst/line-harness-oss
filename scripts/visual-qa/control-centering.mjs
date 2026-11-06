/** 実画面の選択入力と、セル・ラベル・設定行の中央の差をCSSピクセルで返す。 */
export function measureControlCentering(scope = 'body') {
  const root = document.querySelector(scope)
  if (!root) return { measured: [], skipped: [], findings: [{ reason: 'scope-missing', scope }] }
  const measured = [], skipped = []
  for (const input of root.querySelectorAll('input[type="checkbox"],input[type="radio"],button[role="switch"]')) {
    const rect = input.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8 || !input.getClientRects().length) continue
    const label = input.closest('label')
    if (input.parentElement === label && getComputedStyle(input).position === 'absolute') {
      skipped.push({ name: input.getAttribute('aria-label') ?? label.textContent?.trim(), reason: 'corner-indicator' }); continue
    }
    const cell = input.closest('th,td,[role="cell"],[role="columnheader"]')
    const setting = input.closest('[data-setting-checkbox]')
    const text = label?.textContent?.trim()
    // セル単独のチェックはセル、ラベル付きは本文の1行にそろえる。
    let target = !text && cell ? cell : !text && setting ? setting.parentElement : label
    if (!target && input.getAttribute('role') === 'switch') target = input.parentElement
    if (!target) { skipped.push({ name: input.getAttribute('aria-label'), reason: 'alignment-target-missing' }); continue }
    const targetRect = target.getBoundingClientRect()
    const offset = rect.top + rect.height / 2 - targetRect.top - targetRect.height / 2
    measured.push({ kind: input.getAttribute('role') ?? input.getAttribute('type'), name: input.getAttribute('aria-label') ?? text,
      target: target.tagName.toLowerCase(), offset, control: rect.toJSON(), frame: targetRect.toJSON() })
  }
  return { measured, skipped, findings: measured.filter(row => Math.abs(row.offset) > 0.5) }
}
