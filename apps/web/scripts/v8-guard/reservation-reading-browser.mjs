/** 卓の詳細の幅と、月の予約名の全文確認を、実際に描いた面で読む。 */
export function collectReservationReading() {
  const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
  const panels = [...document.querySelectorAll('[data-detail-columns="restaurant-tables"] aside')].filter(visible).map(aside => {
    const card = aside.querySelector('section'), box = aside.getBoundingClientRect(), panel = card?.getBoundingClientRect()
    return { width: box.width, height: box.height, cardWidth: panel?.width ?? 0, cardHeight: panel?.height ?? 0 }
  })
  const names = [...document.querySelectorAll('[data-reservation-board][data-kind="seats"][data-columns="dining"][data-axis="month"] [class*="month"] button')].filter(visible).map(button => {
    const name = button.querySelector('[data-list-name] [data-truncated-text]'), box = button.getBoundingClientRect(), css = getComputedStyle(button)
    const rect = name?.getBoundingClientRect(), textCss = name ? getComputedStyle(name) : null
    return { text: button.textContent.trim(), label: button.getAttribute('aria-label'), title: button.title,
      shared: !!name, singleLine: textCss?.whiteSpace === 'nowrap', ellipsis: textCss?.textOverflow === 'ellipsis',
      width: rect?.width ?? 0, available: box.width - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
      contained: !!rect && rect.left >= box.left && rect.right <= box.right + 1,
      tooltip: !!name && name.textContent.trim() === button.textContent.trim() }
  })
  return { panels, names }
}

export function assessReservationReading({ panels = [], names = [] }) {
  const findings = []
  for (const [index, panel] of panels.entries()) {
    const width = Math.max(0, panel.width - panel.cardWidth), height = Math.max(0, panel.height - panel.cardHeight)
    if (!panel.cardWidth || width > 1 || height > 1) findings.push({ kind: 'blank-horizontal', target: `[data-detail-columns="restaurant-tables"] aside:nth-of-type(${index + 1})`, text: '卓の詳細の外に固定幅・引き伸ばした空の欄が残る', measure: { excess: Math.max(width, height) } })
  }
  for (const [index, name] of names.entries()) {
    if (!name.shared || !name.singleLine || !name.ellipsis || !name.tooltip || !name.width || name.width > name.available + 1 || !name.contained || name.label !== name.text || name.title !== name.text) findings.push({ kind: 'shortname', target: `[data-reservation-board][data-kind="seats"][data-columns="dining"][data-axis="month"] button:nth-of-type(${index + 1})`, text: '月の予約名を一行で読み、全文確認して開く形が欠ける', measure: { count: 1 } })
  }
  return findings
}
