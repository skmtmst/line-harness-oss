/** 見出しと各行の内容から列幅を配り、長い文字へ残りを渡す。 */
export function fitGridContentColumns(frame) {
  const rows = [...frame.querySelectorAll(':scope > [role="row"]')]
  if (rows.length < 2 || !frame.clientWidth) return
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return
  const number = value => parseFloat(value) || 0
  const measure = node => {
    if (node.nodeType === 3) {
      const css = getComputedStyle(node.parentElement)
      context.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
      return context.measureText(node.textContent.trim()).width
    }
    if (node.nodeType !== 1) return 0
    const css = getComputedStyle(node)
    if (css.display === 'none' || css.visibility === 'hidden' || node.matches('.sr-only,[hidden],[role="menu"],[role="tooltip"]')) return 0
    if (node.matches('button,input,svg,img')) return node.getBoundingClientRect().width
    const sizes = [...node.childNodes].map(measure).filter(width => width > 0)
    if (!sizes.length && !node.textContent.trim()) return node.getBoundingClientRect().width
    const inline = css.display === 'inline' || css.display === 'inline-flex' || css.display === 'flex' && css.flexDirection === 'row'
    const content = inline ? sizes.reduce((sum, size) => sum + size, 0) + number(css.columnGap) * Math.max(0, sizes.length - 1) : Math.max(0, ...sizes)
    return content + number(css.paddingLeft) + number(css.paddingRight) + number(css.borderLeftWidth) + number(css.borderRightWidth)
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
