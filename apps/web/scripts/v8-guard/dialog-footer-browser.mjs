/** 表示された窓の操作帯を調べる。部品名やファイルごとの許可表には頼らない。 */
export function scanDialogFooters() {
  const findings = []
  for (const footer of document.querySelectorAll('[data-window-actions]')) {
    const buttons = [...footer.querySelectorAll('button, a[href], [role="button"]')].filter(node => node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden')
    for (const button of buttons) if (!footer.contains(button.closest('[data-dialog-actions]'))) findings.push({ kind: 'custom-dialog-actions', label: button.textContent.trim() })
    if (buttons.length === 1 && buttons[0].textContent.trim() === '閉じる') findings.push({ kind: 'reference-dialog-close-footer' })
  }
  return findings
}
