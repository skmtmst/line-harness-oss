/** 表の押せる物の実寸と中心の当たり先を調べる。文字だけの重なり検査とは独立。 */
export default function scanControlOverlap() {
  const findings = []
  const modal = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]')]
    .filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
      && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert]')).at(-1)
  const root = modal || document.querySelector('main') || document.body
  const controls = [...root.querySelectorAll('button,a[href],input:not([type="hidden"]),textarea,select,[role="button"]')]
    .filter(el => !el.matches(':disabled,[aria-disabled="true"]') && (el.closest('tr,[data-shared-part="list-row"],[role="row"],[data-list-row],[data-table-layout="columns"],[data-ctx-row]')
      || el.closest('[data-page-template="create"]') && el.matches('input:not([type="checkbox"]):not([type="radio"]),textarea,select,button[aria-haspopup],button[role="combobox"]') && +getComputedStyle(el).opacity > 0))
    .map(el => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ el, rect }) => rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]'))
  const name = el => el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim() || el.tagName.toLowerCase()
  const selector = el => {
    const parts = []
    for (let p = el; p && p !== root && p.parentElement; p = p.parentElement) {
      const siblings = [...p.parentElement.children].filter(s => s.tagName === p.tagName)
      parts.unshift(`${p.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(p) + 1})`)
    }
    return parts.join(' > ')
  }
  for (let i = 0; i < controls.length; i++) {
    const { el, rect: a } = controls[i]
    for (const { el: other, rect: b } of controls.slice(i + 1)) {
      if (el.contains(other) || other.contains(el)) continue
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (width > 1 && height > 1) findings.push({ kind: 'control-overlap', target: selector(el), other: selector(other), text: `${name(el)} / ${name(other)}`, measure: { width: Math.ceil(width), height: Math.ceil(height) } })
    }
    const x = a.x + a.width / 2, y = a.y + a.height / 2
    if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue
    let clipped = false
    for (let p = el.parentElement; p; p = p.parentElement) {
      const c = getComputedStyle(p), r = p.getBoundingClientRect()
      if ((c.overflowX !== 'visible' && (x < r.left || x >= r.right)) ||
          (c.overflowY !== 'visible' && (y < r.top || y >= r.bottom))) { clipped = true; break }
    }
    // スクロール領域の外にある行は、表示してから操作する。
    if (clipped) continue
    const hit = document.elementFromPoint(x, y)
    if (!hit || el.contains(hit)) continue
    // 開いたメニューや確認窓の下の一覧は、意図的に操作できなくなっている。
    const overlay = hit.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')
    if (overlay && !overlay.contains(el)) continue
    if (hit.closest('label')?.control === el) continue
    findings.push({ kind: 'control-blocked', target: selector(el), other: selector(hit), text: `${name(el)} / ${name(hit)}`.slice(0, 120), measure: { count: 1 } })
  }
  return findings
}
