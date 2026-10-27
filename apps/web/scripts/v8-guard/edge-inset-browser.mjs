/**
 * 白い板の中の主な塊（数の帯・カード・知らせ）が、板の左右の内側の余白からはみ出して
 * 板の端にくっついていないかを測る。内側の余白は題の左端と、型の標準の
 * 内側の余白（--tpl-list-inset）の小さい方。題が印や左の設定メニューの分だけ右にある画面でも、
 * 標準の余白を守っている塊は通す。
 * 表は行の線を板の端まで引き、中身を内側に置く作りなので数えない（中身の切れは別の見張り）。
 * page.evaluate で単独に動く。見本の座標や許可表は持たない。
 */
export default function scanEdgeInset() {
  const findings = []
  const main = document.querySelector('main')
  if (!main) return findings
  const styles = new Map()
  const css = el => { if (!styles.has(el)) styles.set(el, getComputedStyle(el)); return styles.get(el) }
  const title = main.querySelector('[data-page-title]') || main.querySelector('[data-template-region="heading"] :is(h1,h2)') || main.querySelector('h1') || main.querySelector('h2')
  if (!title) return findings
  // 白い板＝題を包む白地のうち一番外側（型の PageFrame も、型を使わない画面の板も同じ見つけ方）。
  let frame = null
  for (let p = title.parentElement; p && p !== main.parentElement; p = p.parentElement) if (css(p).backgroundColor === 'rgb(255, 255, 255)') frame = p
  if (!frame) return findings
  const board = frame.getBoundingClientRect()
  const inset = title.getBoundingClientRect().left - board.left
  // 題そのものが端にある板（本文を全幅で使う特別な画面）は測る基準が無い。
  if (inset < 8) return findings
  const standard = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tpl-list-inset')) || 24
  const need = Math.min(inset, standard)
  const visible = el => {
    for (let p = el; p; p = p.parentElement) {
      const c = css(p)
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false
    }
    const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1
  }
  const selector = el => {
    const parts = []
    for (let p = el; p && p !== frame; p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] || '' : ''
      parts.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : ''))
    }
    return parts.slice(-4).join(' > ')
  }
  const side = (c, s) => c[`border${s}Style`] !== 'none' && parseFloat(c[`border${s}Width`]) > 0
  const painted = c => c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent'
  const kind = el => {
    if (el.matches('[data-template-region="toolbar"]')) return 'toolbar'
    if (el.matches('[data-kpi-strip]')) return el.parentElement?.closest('[data-kpi-strip]') ? null : 'band'
    const c = css(el)
    if (el.matches('[role="alert"],[role="status"],[data-shared-part*="notice"]')) return painted(c) || side(c, 'Left') || c.boxShadow !== 'none' ? 'notice' : null
    const framed = c.boxShadow !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].every(s => side(c, s))
    return framed && parseFloat(c.borderTopLeftRadius) >= 8 ? 'card' : null
  }
  // 左の列・頭・窓・メニュー・表・押せる部品・お客さまの見え方・下に浮かせて置く追従の帯は、
  // 端に付く（または決まった浮かせ方をする）のが作りどおりか、別の見張りの対象。
  const SKIP = '[data-shared-part="sticky-bar"],[data-template-region="folders"],[data-template-region="heading"],[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],nav,table,[data-line-preview-part],[class*="line-preview_phoneRoot__"],[class*="liff-phone-frame_"],button,a,input,select,textarea,label'
  for (const el of frame.querySelectorAll('*')) {
    if (el.closest(SKIP)) continue
    const k = kind(el)
    if (!k || !visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 200 || r.height < 24) continue
    const left = r.left - board.left, right = board.right - r.right
    if (left < need - 1 || right < need - 1) findings.push({ kind: 'edge-hug', target: selector(el), text: k, measure: { left: Math.round(left), right: Math.round(right), inset: Math.round(need) } })
  }
  // 表の線は端まで引いても、中身には題と同じ内側の余白が必要。
  for (const table of frame.querySelectorAll('table')) {
    if (!visible(table) || table.closest('[role="dialog"],[data-line-preview-part]')) continue
    for (const row of table.rows) {
      const cells = [...row.cells].filter(visible)
      if (!cells.length) continue
      const first = cells[0], last = cells.at(-1)
      const left = first.getBoundingClientRect().left + parseFloat(css(first).paddingLeft) - board.left
      const right = board.right - last.getBoundingClientRect().right + parseFloat(css(last).paddingRight)
      if (left < need - 1 || right < need - 1) findings.push({ kind: 'edge-hug', target: selector(row), text: 'table-content', measure: { left: Math.round(left), right: Math.round(right), inset: Math.round(need) } })
    }
  }
  return findings
}
