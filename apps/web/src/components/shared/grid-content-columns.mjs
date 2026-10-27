/** 見出しと各行の内容から列幅を配り、長い文字へ残りを渡す。 */
export function fitGridContentColumns(frame) {
  const rows = [...frame.querySelectorAll(':scope > [role="row"]')]
  if (rows.length < 2 || !frame.clientWidth) return
  const number = value => parseFloat(value) || 0
  // 同じ行に見えない写しを置き、省略や札の余白も含めた本来の幅（max-content）を測る。
  const measure = cell => {
    const probe = cell.cloneNode(true)
    probe.setAttribute('aria-hidden', 'true')
    probe.setAttribute('data-column-probe', '')
    probe.removeAttribute('id')
    probe.style.cssText += ';position:absolute;inset:0 auto auto 0;width:max-content;min-width:0;max-width:none;visibility:hidden;pointer-events:none'
    cell.parentElement.append(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  }
  const css = getComputedStyle(rows[0])
  const count = rows[0].children.length
  const available = frame.clientWidth - number(css.paddingLeft) - number(css.paddingRight) - number(css.columnGap) * (count - 1)
  const wanted = [...rows[0].children].map((_, index) => Math.ceil(Math.max(...rows.map(row => row.children[index] ? measure(row.children[index]) : 0))))
  // 短い列は内容幅で止め、長い列だけ同じ上限で縮める。
  const fixed = [...rows[0].children].map((_, index) => rows.some(row => row.children[index]?.querySelector('button,input,[role="button"]')))
  const flexibleRoom = Math.max(0, available - wanted.reduce((sum, width, index) => sum + (fixed[index] ? width : 0), 0))
  let low = 0, high = Math.max(...wanted)
  for (let i = 0; i < 24; i++) {
    const cap = (low + high) / 2
    if (wanted.reduce((sum, width, index) => sum + (fixed[index] ? 0 : Math.min(width, cap)), 0) > flexibleRoom) high = cap
    else low = cap
  }
  const widths = wanted.map((width, index) => fixed[index] ? width : Math.min(width, low))
  const spare = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0))
  const marked = [...rows[0].children].findIndex(cell => cell.hasAttribute('data-cell-grow'))
  const growIndex = marked >= 0 ? marked : wanted.indexOf(Math.max(...wanted))
  widths[growIndex] += spare
  const columns = widths.map(width => `${width}px`).join(' ')
  if (frame.style.getPropertyValue('--grid-table-content-columns') !== columns) frame.style.setProperty('--grid-table-content-columns', columns)
}
