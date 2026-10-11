/** B-219〜B-233。実寸と実際に描かれた状態を検査する。 */
export default function scanPendec2Rules() {
  const root = document.body, findings = []
  const css = el => getComputedStyle(el)
  const visible = el => {
    if (!el || el.closest('svg,script,style,[inert],[data-line-preview-part="talk"],[data-template-region="folders"]')) return false
    for (let p = el; p; p = p.parentElement) { const c = css(p); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false }
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
  const add = (kind, el, measure, other) => findings.push({ kind, target: sel(el), text: (el.innerText || el.textContent || '').replace(/\s+/g,' ').slice(0,120), measure, ...(other ? {other:sel(other)} : {}) })
  const all = selector => [...root.querySelectorAll(selector)].filter(visible)
  const framed = el => { const c=css(el); return c.outlineStyle !== 'none' && parseFloat(c.outlineWidth)>0 || ['Top','Right','Bottom','Left'].every(x => c['border'+x+'Style']!=='none' && parseFloat(c['border'+x+'Width'])>0) || c.boxShadow!=='none' }
  const choiceSelector = '[data-choice-card],label[class*="radio-card_card"]:not([data-variant="row"]),label[class*="layout-picker_tile"]'
  const cardSelector = '[data-card-variant]:not([data-card-unframed]), [data-liff-card], [data-rule-card],'+choiceSelector
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
    const leaves=children.filter(el=>el.childElementCount===0 && el.textContent.trim())
    if(leaves.length && !card.matches(choiceSelector)) { const gap=r.bottom-Math.max(...leaves.map(el=>el.getBoundingClientRect().bottom)); if(gap<16-1) add('cardbottom',card,{deficit:Math.ceil(16-gap)}) }
  }
  for(const board of all('[data-page-template]')) {
    if(board.querySelector('[data-shared-part="sticky-bar"]')) continue
    const children=[...board.children].filter(visible)
    if(!children.length) continue
    const gap=board.getBoundingClientRect().bottom-Math.max(...children.map(el=>el.getBoundingClientRect().bottom))
    if(gap<23) add('canvasbottom',board,{deficit:Math.ceil(24-gap)})
  }
  for(const band of all('[data-kpi-strip],[data-kpi-band]')) {
    const details=[...band.querySelectorAll('[data-kpi-detail]')]
    const hasDetail=details.some(el=>el.hasAttribute('data-kpi-detail-present') || el.textContent.trim() || el.querySelector('a[href],button'))
    if(!hasDetail && details.some(visible)) add('kpiblank',band,{count:1})
    if(hasDetail && details.some(el=>!visible(el))) add('kpialign',band,{count:1})
  }
  for(const seg of all('[data-segmented-control],[class*="segmented_root"]')) {
    const buttons=[...seg.querySelectorAll(':scope > button')].filter(visible)
    for(const b of buttons) if(!b.textContent.trim() && !b.getAttribute('aria-label')) add('segempty',b,{count:1})
    const selected=buttons.filter(b=>b.getAttribute('aria-pressed')==='true')
    if(buttons.length && selected.length!==1) add('segselected',seg,{count:Math.abs(selected.length-1) || 1})
    if(selected.length===1) { const c=css(selected[0]); if(c.backgroundColor!=='rgb(232, 245, 236)' || c.color!=='rgb(8, 122, 62)' || !framed(selected[0])) add('segstyle',selected[0],{count:1}) }
  }
  for(const card of all(choiceSelector)) {
    const radio=card.querySelector('input[type="radio"]'), r=card.getBoundingClientRect()
    if(!radio || !visible(radio)) { add('choice-radio',card,{count:1}); continue }
    const rr=radio.getBoundingClientRect()
    if(Math.abs(r.right-rr.right-16)>2 || Math.abs(rr.top-r.top-16)>2) add('choice-radio',card,{excess:Math.ceil(Math.max(Math.abs(r.right-rr.right-16),Math.abs(rr.top-r.top-16)))})
    if(radio.checked) { const c=css(card); if(!['rgb(241, 248, 243)','rgb(232, 245, 236)'].includes(c.backgroundColor) || ![c.borderTopColor,c.outlineColor].includes('rgb(8, 122, 62)')) add('choice-color',card,{count:1}) }
  }
  for(const pager of all('[data-pagination],nav[class*="pagination_pagination"]')) {
    for(const button of [...pager.querySelectorAll('button')].filter(visible)) if(!framed(button)) add('pageredge',button,{count:1})
  }
  for(const table of all('[data-shared-part="list-table"],table,[role="table"]')) {
    const rows=[...table.querySelectorAll('tbody > tr,[role="row"]')].filter(visible)
    if(!rows.some(row=>row.querySelector('[data-row-menu],[data-row-actions], [data-action-cell]'))) continue
    for(const row of rows) if(row.querySelector('button,a[href]') && !row.querySelector('[data-row-menu]')) add('rowmenu',row,{count:1})
  }
  for(const band of all('[role="alert"],[data-design-part="notice"],[data-notice]')) {
    const next=band.nextElementSibling
    if(!visible(next) || !framed(next) || !framed(band) && css(band).backgroundColor==='rgba(0, 0, 0, 0)') continue
    const a=band.getBoundingClientRect(),b=next.getBoundingClientRect(),gap=b.top-a.bottom
    if(b.left<a.right && a.left<b.right && gap>=0 && gap<11) add('bandtouch',band,{deficit:Math.ceil(12-gap)},next)
  }
  for(const panel of all('[data-customer-info-panel]')) if(![...panel.querySelectorAll('button')].some(b=>b.textContent.includes('表示項目を編集'))) add('customer-edit',panel,{count:1})
  for(const row of all('[data-message-insert-row]')) if(!row.closest('[data-message-body]')) add('insertoutside',row,{count:1})
  for(const button of all('[data-message-insert-button]')) if(!button.querySelector('svg') || css(button).borderTopStyle!=='none' && parseFloat(css(button).borderTopWidth)>0) add('insertlegacy',button,{count:1})
  for(const row of all('div[class*="insertRow"],div[class*="insertBar"],div[class*="insertChips"]')) {
    if(row.closest('[data-message-insert-row]') || row.querySelector('[data-message-insert-row]')) continue
    if(row.querySelector('button') && /差し込|名前|共通情報/.test(row.textContent)) add('insertlegacy',row,{count:1})
  }
  const liffCards = '[data-liff-card],.sb-card,.eb-card:not(.eb-card-success),.af-card,.wb-card,.nm-card,.nm-ai-card,.nm-subscription-card,.nm-order-card,.nm-photo-form-card,.nm-photo-entry,.form-body'
  for(const card of all(liffCards)) {
    if(card.matches('button,input,textarea,select,[data-selected],.selected,.active')) continue
    const shadow=css(card).boxShadow.replace(/\s+/g,'')
    if(shadow!=='rgba(29,29,31,0.16)0px1px1px0px,rgba(29,29,31,0.08)0px2px4px0px') add('liffshadow',card,{count:1})
  }
  for(const radio of all('[data-liff-root] input[type="radio"],.form-body input[type="radio"]')) {
    const r=radio.getBoundingClientRect(), image=css(radio).backgroundImage
    if(Math.abs(r.width-18)>0.5 || Math.abs(r.height-18)>0.5 || radio.checked && !image.includes('4.5px')) add('liffradio',radio,{count:1})
  }
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
  while(walker.nextNode()) { const n=walker.currentNode; if(visible(n.parentElement) && /小窓|引き出し：|の窓：/.test(n.textContent)) add('internal-window-copy',n.parentElement,{count:1}) }
  return findings
}
