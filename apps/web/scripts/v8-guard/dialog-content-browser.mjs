export function scanDialogContent({ verbActions = false, deleteQuestion = false, requiredReply = false, accountPicker = false, history = false, insertion = false, changedValues = false } = {}) {
  const panel = document.querySelector('[data-m1-scope]')
  if (!panel) return { findings: [], inventory: [] }
  const findings = [], inventory = []
  const add = (pattern, kind, details = {}) => findings.push({ pattern, kind, ...details })
  if (verbActions) for (const el of panel.querySelectorAll('button,[role="menuitem"]')) {
    const text = el.innerText.trim()
    if (['削除', '変更を保存'].includes(text)) add('F3', 'dialog-action-verb', { text })
  }
  if (deleteQuestion && !panel.querySelector('h2')?.textContent.trim().endsWith('を削除しますか？')) add('F3', 'dialog-delete-question')
  if (requiredReply) {
    const input = panel.querySelector('#quick-create-reply')
    const requirement = input?.closest('[data-form-requirement]')?.getAttribute('data-form-requirement')
    inventory.push({ kind: 'reply-requirement', requirement })
    if (requirement !== 'required') add('F4', 'dialog-reply-required')
  }
  if (accountPicker) {
    const summary = [...panel.querySelectorAll('button')].find(el => `${el.textContent} ${el.getAttribute('aria-label') ?? ''}`.includes('担当アカウント'))
    const choices = panel.querySelectorAll('input[type="checkbox"],[role="checkbox"]').length
    inventory.push({ kind: 'account-summary', present: Boolean(summary), inlineChoices: choices })
    if (!summary || choices) add('F5', 'dialog-account-inline-list', { choices })
  }
  if (history) {
    const create = [...panel.querySelectorAll('button')].find(el => el.innerText.trim() === '新しい版を作る')
    const inFooter = Boolean(create?.closest('[data-dialog-actions]'))
    const card = [...panel.querySelectorAll('h3')].find(el => el.textContent === '予約中の版')?.parentElement
    const menus = card?.querySelectorAll('[aria-haspopup="menu"]').length ?? 0
    const reservedRows = card?.querySelectorAll('strong').length ?? 0
    const cardWidth = card?.getBoundingClientRect().width ?? 0
    const available = card?.parentElement.getBoundingClientRect().width ?? 0
    inventory.push({ kind: 'history', inFooter, menus, reservedRows, cardWidth, available })
    if (!inFooter) add('F9', 'dialog-history-create-slot')
    if (cardWidth < available - 1) add('F6', 'dialog-history-card-width')
    if (reservedRows && menus < reservedRows) add('F4', 'dialog-history-reserved-menu')
  }
  if (insertion) {
    const body = panel.querySelector('[data-message-body]')
    const row = panel.querySelector('[data-message-insert-row]')
    const count = panel.querySelector('[data-message-character-count]')
    if (!body || !row || !count || !body.contains(row) || !row.contains(count)) add('F5', 'dialog-message-insertion-outside')
  }
  if (changedValues) {
    const probe = document.createElement('span'); probe.style.color = 'var(--color-accent-deep)'; panel.append(probe)
    const expected = getComputedStyle(probe).color; probe.remove()
    for (const name of ['変更量', '変更後', '変更後の残高']) {
      const label = [...panel.querySelectorAll('p')].find(el => el.textContent.trim() === name)
      const value = label?.nextElementSibling
      if (!value || value.textContent.trim() === '—') continue
      const actual = getComputedStyle(value.querySelector('span') ?? value).color
      inventory.push({ kind: 'changed-value', name, actual, expected })
      if (actual !== expected) add('F6', 'dialog-changed-value-color', { name, actual, expected })
    }
  }
  return { findings, inventory }
}
