/** 初期設定の共通行を実ブラウザで測る。幅0の箱も測定対象に残す。 */
export function measureSetupStepLayout() {
  return Array.from(document.querySelectorAll('[data-setup-step-list]')).filter(list => list.getClientRects().length > 0).map(list => ({
    width: list.getBoundingClientRect().width,
    gap: Number.parseFloat(getComputedStyle(list).rowGap),
    rows: Array.from(list.querySelectorAll('[data-setup-step-row]')).map(row => {
      const bounds = row.getBoundingClientRect()
      const label = row.querySelector('[data-setup-step-label]')
      const help = row.querySelector('[data-setup-step-help]')
      return { helpGap: label && help ? help.getBoundingClientRect().left - label.getBoundingClientRect().right : null, width: bounds.width, height: bounds.height, overflow: row.scrollWidth - row.clientWidth, labelOverflow: Math.max(0, ...Array.from(row.querySelectorAll('[data-setup-step-label]')).map(label => label.scrollWidth - label.clientWidth)) }
    }),
  }))
}
export function setupStepLayoutFailures(lists) {
  const failures = []
  for (const list of lists) {
    if (!(list.width > 0)) failures.push('setup step list has collapsed')
    if (!(list.gap >= 8)) failures.push('setup step rows need at least 8px gap')
    for (const row of list.rows) {
      if (!(row.width > 0) || !(row.height >= 60)) failures.push('setup step row is too small')
      if (row.overflow > 1) failures.push('setup step row overflows')
      if (row.helpGap !== null && row.helpGap !== undefined && (row.helpGap < -1 || row.helpGap > 9)) failures.push('setup step help is detached from its label')
      if (row.labelOverflow > 1) failures.push('setup step label is clipped')
    }
  }
  return failures
}
