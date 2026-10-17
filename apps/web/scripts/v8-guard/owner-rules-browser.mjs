/** 描画された箱が親の切り抜きで欠けていないかを測る。 */
export default function scanOwnerRules() {
  const findings = [], root = document.querySelector('main') || document.body
  const styles = new Map()
  const css = el => { if (!styles.has(el)) styles.set(el, getComputedStyle(el)); return styles.get(el) }
  const visible = el => {
    for (let p = el; p; p = p.parentElement) {
      // 閉じた設定は描画されない。開いた設定とsummaryは検査する。
      if (p !== el && p.matches('details:not([open])') && !p.querySelector(':scope > summary')?.contains(el)) return false
      const c = css(p)
      if (c.display === 'none' || c.visibility === 'hidden' || c.visibility === 'collapse' || +c.opacity === 0 || c.clipPath === 'inset(50%)' || /^rect\(0px[, ]+0px[, ]+0px[, ]+0px\)$/.test(c.clip) || p.hasAttribute('inert')) return false
    }
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
  }
  const selector = el => {
    const parts = []
    for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : ''
      const peers = p.parentElement ? [...p.parentElement.children].filter(s => s.tagName === p.tagName) : [p]
      parts.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : '') + ':nth-of-type(' + (peers.indexOf(p)+1) + ')')
    }
    return parts.join(' > ')
  }
  const add = (kind, el, measure, text = '', other) => findings.push({kind,target:selector(el),text:text.replace(/\s+/g,' ').slice(0,120),measure,...(other?{other:selector(other)}:{})})
  const hasBorder = c => ['Top','Right','Bottom','Left'].every(side => c[`border${side}Style`] !== 'none' && parseFloat(c[`border${side}Width`]) > 0) || c.boxShadow !== 'none'
  // 小窓・吹き出し・通知はmainの外へ描かれる。面の検査はその口にも届かせる。
  const portals = [...document.querySelectorAll('[role="dialog"],[role="tooltip"],[aria-label="知らせ"]')]
  const surfaces = [...new Set([root,...root.querySelectorAll('*'),...portals.flatMap(el => [el,...el.querySelectorAll('*')])])]
  for (const el of surfaces.filter(visible)) {
    const c = css(el), r = el.getBoundingClientRect(), name = el.getAttribute('data-pencil-name') || ''
    // 時間×卓、スマホの見え方、画像そのものは意図した端接触。ALLOW.tsvと同じ対象限定。
    // 古いbaseにも同じ判定を当てる。共通部品の既存の印も読む。
    const phone = el.closest('[data-line-preview-part],[class*="line-preview_phoneRoot__"]')
    const media = phone || el.closest('video,[data-media-slot],[data-qr-code], [data-booking-calendar],[role="grid"]') || /写真|画像の枠|サムネ|時間×卓|スマホ|見え方/.test(name)
    if (!media && hasBorder(c) && r.width>=80 && r.height>=40) {
      for (let p=el.parentElement; p && p!==document.body; p=p.parentElement) {
        const pc=css(p)
        if (pc.overflowY==='visible') continue
        const q=p.getBoundingClientRect()
        // 明示したスクロール欄は、先へ送る操作が実在する場合だけ許す。
        if (['auto','scroll'].includes(pc.overflowY) && p.scrollHeight>p.clientHeight) break
        if (r.bottom>q.bottom+2 && r.top<q.bottom-8) add('boxclip',el,{excess:Math.ceil(r.bottom-q.bottom)},'',p)
        break
      }
    }
  }
  return findings
}
