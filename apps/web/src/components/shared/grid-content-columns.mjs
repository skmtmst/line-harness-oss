/** 見出しと各行の内容から列幅を配り、長い文字へ残りを渡す。 */
export function fitGridContentColumns(frame) {
  const rows = [...frame.querySelectorAll(':scope > [role="row"]')]
  if (rows.length < 2 || !frame.clientWidth) return
  const number = value => parseFloat(value) || 0
  // 写しはすべて置いてから幅を読み、最後にまとめて外す。セルごとのread/writeを交互にしない。
  const probes = rows.map(row => [...row.children].map(cell => {
    const copy = node => {
      if (node.nodeType === 3) return node.cloneNode()
      if (node.nodeType !== 1) return document.createTextNode('')
      // 通信や接続処理を持つ物は実寸の空要素へ。フォームは名前・所属・選択を外し、自然な幅だけ測る。
      if (node.matches('img,video,audio,iframe,object,embed,source,canvas,svg,image,use,script,style,link,input[type="image"]') || node.localName.includes('-')) {
        const rect = node.getBoundingClientRect(), placeholder = document.createElement('span')
        placeholder.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;flex:none`
        return placeholder
      }
      const clone = node.cloneNode(false)
      for (const attr of ['id','name','form','for','autofocus']) clone.removeAttribute(attr)
      if (node.matches('input')) { clone.checked = false; clone.removeAttribute('checked'); if (node.type !== 'file') clone.value = node.value }
      if (node.matches('button')) clone.setAttribute('type', 'button')
      for (const child of node.childNodes) clone.append(copy(child))
      if (node.matches('textarea')) clone.value = node.value
      if (node.matches('select')) [...node.options].forEach((option, index) => { if (clone.options[index]) clone.options[index].selected = option.selected })
      return clone
    }
    const probe = copy(cell)
    probe.setAttribute('aria-hidden', 'true')
    probe.setAttribute('inert', '')
    probe.setAttribute('data-column-probe', '')
    probe.removeAttribute('id')
    for (const child of probe.querySelectorAll('[id]')) child.removeAttribute('id')
    probe.style.cssText += ';position:absolute;inset:0 auto auto 0;width:max-content;min-width:0;max-width:none;visibility:hidden;pointer-events:none'
    return probe
  }))
  let measured
  try {
    rows.forEach((row, index) => row.append(...probes[index]))
    measured = probes.map(row => row.map(probe => Math.ceil(probe.getBoundingClientRect().width)))
  }
  finally { for (const row of probes) for (const probe of row) probe.remove() }
  const css = getComputedStyle(rows[0])
  const count = rows[0].children.length
  const room = frame.clientWidth - number(css.paddingLeft) - number(css.paddingRight)
  const gap = number(css.columnGap)
  const available = room - gap * (count - 1)
  const wanted = [...rows[0].children].map((_, index) => Math.max(...measured.map(row => row[index] ?? 0)))
  const fixed = [...rows[0].children].map((_, index) => rows.some(row => row.children[index]?.querySelector('button,input,[role="button"]')))
  // 見出しが読める実幅を下限にする。無題の列も実際の1文字分を残す。
  const minimum = wanted.map((width, index) => fixed[index] ? width : Math.min(width, Math.max(measured[0][index] ?? 0, number(getComputedStyle(rows[0].children[index]).fontSize))))
  const minimumTotal = minimum.reduce((sum, width) => sum + width, 0)
  if (minimumTotal > available) {
    // 既存の2段表示へ戻す。残りの列も必要なら段を増やし、操作を隠さない。
    if (!frame.hasAttribute('data-stacked')) { frame.gridContentStacked = true; frame.dataset.stacked = '' }
    const rest = minimum.slice(1)
    const minTrack = Math.min(room, Math.max(...rest, 1))
    frame.style.setProperty('--grid-table-content-rest-columns', `repeat(auto-fit,minmax(${minTrack}px,1fr))`)
    frame.style.removeProperty('--grid-table-content-columns')
    return
  }
  if (frame.gridContentStacked) delete frame.dataset.stacked
  delete frame.gridContentStacked
  frame.style.removeProperty('--grid-table-content-rest-columns')
  let low = 0, high = Math.max(...wanted)
  for (let i = 0; i < 24; i++) {
    const cap = (low + high) / 2
    if (wanted.reduce((sum, width, index) => sum + (fixed[index] ? width : Math.max(minimum[index], Math.min(width, cap))), 0) > available) high = cap
    else low = cap
  }
  const widths = wanted.map((width, index) => fixed[index] ? width : Math.max(minimum[index], Math.min(width, low)))
  const spare = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0))
  const marked = [...rows[0].children].findIndex((cell, index) => cell.hasAttribute('data-cell-grow') && !fixed[index])
  const growIndex = marked >= 0 ? marked : wanted.reduce((best, width, index) => !fixed[index] && (best < 0 || width > wanted[best]) ? index : best, -1)
  if (growIndex >= 0) widths[growIndex] += spare
  const columns = widths.map(width => `${width}px`).join(' ')
  if (frame.style.getPropertyValue('--grid-table-content-columns') !== columns) frame.style.setProperty('--grid-table-content-columns', columns)
}

/** 内容計測だけが付けた段組み・幅を外し、既存の段組みの印は変えない。 */
export function clearGridContentColumns(frame) {
  frame.style.removeProperty('--grid-table-content-columns')
  frame.style.removeProperty('--grid-table-content-rest-columns')
  if (frame.gridContentStacked) delete frame.dataset.stacked
  delete frame.gridContentStacked
}
