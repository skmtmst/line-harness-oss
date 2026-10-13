/** Count visible repeated list operations and selection in a read-only list.
 * This is semantic evidence in addition to geometric F1-F10 checks. */
export default function scanListOperations() {
  const visible = el => {
    const box = el.getBoundingClientRect()
    return box.width > 1 && box.height > 1 && getComputedStyle(el).visibility !== 'hidden'
      && !el.closest('[hidden],[inert],[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"]')
  }
  const findings = [], inventory = []
  for (const root of document.querySelectorAll('[data-page-template="list"]')) {
    if (!visible(root)) continue
    const readOnly = [...root.querySelectorAll('[data-read-only-notice]')].some(visible)
    const checks = [...root.querySelectorAll('thead input[type="checkbox"],tbody input[type="checkbox"],thead [role="checkbox"],tbody [role="checkbox"]')].filter(visible)
    if (readOnly) for (const check of checks) findings.push({pattern:'F8', reason:'read-only list exposes a selection operation', label:check.getAttribute('aria-label')})
    const controls = [...root.querySelectorAll('[data-template-region="toolbar"] button,[data-template-region="toolbar"] a[href],[data-template-region="toolbar"] select')].filter(visible)
    const groups = new Map()
    for (const control of controls) {
      const label = (control.getAttribute('aria-label') || control.textContent || '').replace(/\s+/g,' ').trim()
      const isFolder = /^(フォルダ)(?:で絞り込む|：|$)/.test(label)
      const isCreate = /作る|登録する/.test(control.textContent || '') && !control.hasAttribute('aria-haspopup')
      if (!isFolder && !isCreate) continue
      const key = isFolder ? 'folder' : `create:${control.getAttribute('href') || label}`
      const group = groups.get(key) || []; group.push(control); groups.set(key,group)
    }
    for (const [key, group] of groups) for (const extra of group.slice(1)) findings.push({pattern:'F4',reason:'list operation is rendered twice',operation:key,label:extra.getAttribute('aria-label') || extra.textContent.trim()})
    inventory.push({board:root.dataset.designNode,readOnly,checks:checks.length,operations:[...groups].map(([operation,controls])=>({operation,count:controls.length}))})
  }
  return {findings,inventory}
}
