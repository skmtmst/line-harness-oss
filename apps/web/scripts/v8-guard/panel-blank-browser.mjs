/** detect.cjs の blank 判定。blank-gap と共通で使う（下の余り64px以上）。 */
export default function scanPanelBlank() {
  const root = document.querySelector('main') || document.body
  const findings = []
  const visible = el => {
    for (let p = el; p; p = p.parentElement) {
      const c = getComputedStyle(p)
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const selector = el => {
    const parts = []
    for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/).filter(Boolean)[0] : ''
      const siblings = p.parentElement ? [...p.parentElement.children].filter(s => s.tagName === p.tagName) : [p]
      parts.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : '') + ':nth-of-type(' + (siblings.indexOf(p) + 1) + ')')
    }
    return parts.join(' > ')
  }
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!visible(el)) continue
    let excluded = false
    for (let p = el; p; p = p.parentElement) {
      if (p.matches('nav,[data-template-region="folders"],[data-template-region="collapsed-folders"],[data-line-preview-part="talk"]') ||
          /フォルダの列|左メニュー/.test(p.getAttribute('data-pencil-name') || '') ||
          /(?:^|[ _-])(?:bubbleBody|bubbleText|bubbleIn|bubbleOut|messageBubble|bubble)(?:[_ -]|$)/i.test(typeof p.className === 'string' ? p.className : '')) { excluded = true; break }
    }
    if (excluded) continue
    const c = getComputedStyle(el)
    const box = (c.borderTopStyle !== 'none' && c.borderTopWidth !== '0px') || c.boxShadow !== 'none' || c.backgroundColor === 'rgb(255, 255, 255)'
    const r = el.getBoundingClientRect()
    if (!box || r.height < 200 || r.width < 200) continue
    let bottom = r.top
    for (const d of el.querySelectorAll('*')) {
      if (!visible(d)) continue
      const dr = d.getBoundingClientRect()
      if (dr.bottom <= r.bottom + 1 && (d.childElementCount === 0 || d.textContent.trim() === '' || [...d.children].every(x => x.tagName === 'BR'))) bottom = Math.max(bottom, dr.bottom)
    }
    // Web の main が縦送りの枠でも、画面いっぱいの板の下は数えない。
    const height = document.documentElement.scrollHeight
    const fillsPage = height <= innerHeight + 10 && r.bottom >= height - 40
    const gap = r.bottom - bottom
    if (gap >= 64 && !fillsPage) findings.push({ kind: 'blank', target: selector(el), text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120), measure: { gap: Math.floor(gap) } })
  }
  return findings
}
