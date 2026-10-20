/** 入力要件の矛盾・入力エラーの理由・破壊的操作の区別を確認する。 */
export default function scanB244Rules() {
  const findings = []
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const key = el => {
    const parts = []
    for (let p = el; p && p !== document.body; p = p.parentElement) parts.unshift(`${p.tagName.toLowerCase()}:nth-child(${[...p.parentElement.children].indexOf(p) + 1})`)
    return parts.join(' > ')
  }
  const add = (kind, el, text, measure = { count: 1 }) => findings.push({ kind, target: key(el), text, measure })
  for (const field of document.querySelectorAll('[data-form-requirement]')) {
    if (!visible(field)) continue
    const label = field.querySelector('label')?.parentElement?.textContent || ''
    const required = field.dataset.formRequirement === 'required'
    if (required && /任意/.test(label) || !required && /必須/.test(label)) add('requirement-conflict', field, label)
    for (const input of field.querySelectorAll('input:not([type=hidden]),textarea,select,button[aria-required]')) {
      if (input.closest('[data-form-requirement]') !== field || !visible(input)) continue
      if (input.required && !required) add('requirement-conflict', field, label)
      if (input.getAttribute('aria-invalid') === 'true') {
        const reasons = (input.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)).filter(el => visible(el) && el.getAttribute('role') === 'alert' && el.textContent.trim())
        if (!reasons.length) add('field-error-missing', input, input.getAttribute('aria-label') || label)
      }
    }
  }
  for (const menu of document.querySelectorAll('[role=menu]')) {
    if (!visible(menu)) continue
    const items = [...menu.querySelectorAll('[role=menuitem]')].filter(visible)
    let last = -1
    const groups = ['view', 'manage', 'destructive']
    items.forEach(item => {
      const declared = item.closest('[data-menu-group]')?.dataset.menuGroup
      const dangerous = /停止|止める|削除|消す|取り消|取消/.test(item.textContent) && !/再開|復元/.test(item.textContent)
      const group = dangerous ? 2 : groups.indexOf(declared)
      if (group < last || dangerous && declared !== 'destructive') add('menu-group-order', item, item.textContent.trim())
      last = Math.max(group, last)
    })
  }
  return findings
}
