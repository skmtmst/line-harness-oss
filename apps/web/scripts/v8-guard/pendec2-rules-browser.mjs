/** 〜。実寸と実際に描かれた状態を検査する。 */
export default function scanPendec2Rules() {
  const root = document.body, findings = []
  const css = el => getComputedStyle(el)
  const visible = el => {
    if (!el || el.closest('svg,script,style,[inert],[data-line-preview-part="talk"],[data-template-region="folders"]')) return false
    for (let p = el; p; p = p.parentElement) {
      // 一般の崩れ検査と同じ。閉じた詳細設定の本文は描かれていない。
      if (p !== el && p.matches('details:not([open])') && !p.querySelector(':scope > summary')?.contains(el)) return false
      const c = css(p); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false
    }
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
  }
  const sel = el => {
    const parts = []
    for (let p = el; p && p !== root; p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : ''
      const peers = p.parentElement ? [...p.parentElement.children].filter(x => x.tagName === p.tagName) : [p]
      parts.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : '') + ':nth-of-type('+(peers.indexOf(p)+1)+')')
    }
    return parts.join(' > ')
  }
  const add = (kind, el, measure, other) => findings.push({ kind, target: sel(el), text: ((kind === 'canvasbottom' ? el.querySelector('h1,h2')?.textContent : null) || el.innerText || el.textContent || '').replace(/\s+/g,' ').slice(0,120), measure, ...(other ? {other:sel(other)} : {}) })
  const all = selector => [...root.querySelectorAll(selector)].filter(visible)
  const framed = el => { const c=css(el); return c.outlineStyle !== 'none' && parseFloat(c.outlineWidth)>0 || ['Top','Right','Bottom','Left'].every(x => c['border'+x+'Style']!=='none' && parseFloat(c['border'+x+'Width'])>0) || c.boxShadow!=='none' }
  const choiceSelector = '[data-choice-card],label[class*="radio-card_card"]:not([data-variant="row"]),label[class*="layout-picker_tile"]'
  // baseのCardにも付いている印で読む。新しい属性の追加自体を新規崩れにしない。
  const cardSelector = '[data-design-part="card"]:not([data-card-unframed]), [data-card-variant]:not([data-card-unframed]), [data-liff-card], [data-rule-card],'+choiceSelector
  for (const card of all(cardSelector)) {
    if (card.querySelector('table,[role="table"],[data-shared-part="list-table"]') || !framed(card)) continue
    const r=card.getBoundingClientRect(), c=css(card)
    const children=[...card.querySelectorAll('*')].filter(el => {
      if(!visible(el) || el.closest('[data-menu-portal],[role="tooltip"]')) return false
      for(let parent=el;parent && parent!==card;parent=parent.parentElement) if(['fixed','absolute'].includes(css(parent).position)) return false
      return true
    })
    let excess=0
    for (const el of children) { const b=el.getBoundingClientRect(); excess=Math.max(excess,b.right-r.right,r.left-b.left,b.bottom-r.bottom,r.top-b.top) }
    if(excess>2 || card.scrollHeight>card.clientHeight+2 && c.overflowY!=='auto') add('cardspill',card,{excess:Math.ceil(Math.max(excess,card.scrollHeight-card.clientHeight))})
  }
  for(const seg of all('[data-segmented-control],[class*="segmented_root"]')) {
    const buttons=[...seg.querySelectorAll(':scope > button')].filter(visible)
    for(const b of buttons) if(!b.textContent.trim() && !b.getAttribute('aria-label')) add('segempty',b,{count:1})
    const selected=buttons.filter(b=>b.getAttribute('aria-pressed')==='true')
    if(buttons.length && selected.length!==1) add('segselected',seg,{count:Math.abs(selected.length-1) || 1})

  }
  return findings
}
