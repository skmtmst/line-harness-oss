/** B-244：描画した札・欄の理由・行メニュー・狭い板の件数を測る。 */
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
      if (!item.querySelector('svg')) add('menu-icon-missing', item, item.textContent.trim())
    })
  }
  for (const toolbar of document.querySelectorAll('[data-list-toolbar]')) {
    // 型の外枠でなく、道具自身の内側の右端を測る。Frame内のRowは重ねて数えない。
    if (!visible(toolbar) || toolbar.parentElement.closest('[data-list-toolbar][data-toolbar-layout]') || !toolbar.hasAttribute('data-toolbar-layout') && toolbar.querySelector('[data-list-toolbar][data-toolbar-layout]')) continue
    const board = toolbar.closest('[data-page-template]') ?? toolbar
    if (board.getBoundingClientRect().width >= 1100) continue
    const search = toolbar.querySelector('[data-toolbar-search]')
    const counts = [...toolbar.querySelectorAll('[data-page-size], [data-per-page-select], [data-toolbar-role=count]')].filter(visible)
    for (const count of counts) {
      const c = count.getBoundingClientRect(), s = search && visible(search) ? search.getBoundingClientRect() : null, t = toolbar.getBoundingClientRect()
      const style = getComputedStyle(toolbar)
      const right = t.right - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderRightWidth) || 0)
      if (s && c.top < s.bottom - 4 || right - c.right > 8) add('toolbar-count-position', count, '狭い板の表示件数は2段目の右端', { leftGap: Math.max(0, Math.ceil(right - c.right)), rowDeficit: s ? Math.max(0, Math.ceil(s.bottom - c.top)) : 0 })
    }
    for (const button of toolbar.querySelectorAll('button')) if (visible(button) && /^(…|\.\.\.)$/.test(button.textContent.trim())) add('toolbar-unnamed-menu', button, '道具の名前を省略しない')
  }
  return findings
}
