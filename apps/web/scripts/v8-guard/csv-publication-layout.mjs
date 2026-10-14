/** CSVの追加口・掲載の説明を、通常の崩れ検査とは別に確かめる。 */
export function inspectCsvPublicationLayout() {
  const visible = element => Boolean(element && element.getBoundingClientRect().width && element.getBoundingClientRect().height && getComputedStyle(element).visibility !== 'hidden')
  const failures = []
  const zone = document.querySelector('[data-design-node="T9gblG"] input[type="file"]')?.closest('[data-variant]') ?? document.querySelector('[aria-label="CSVを追加"][data-variant]')
  const csv = zone && visible(zone) ? {
    innerButtons: zone.querySelectorAll('button').length,
    hintLines: (zone.querySelector('[class*=zoneHint]')?.querySelectorAll('br').length ?? -1) + 1,
    focusable: zone.tabIndex === 0,
    disabled: zone.hasAttribute('data-disabled') || zone.hasAttribute('data-busy'),
    role: zone.getAttribute('role'),
    titleWeight: zone.querySelector('[class*=zoneTitle]') ? getComputedStyle(zone.querySelector('[class*=zoneTitle]')).fontWeight : null,
    hasUploadIcon: Boolean(zone.querySelector('svg.lucide-upload')),
  } : null
  if (csv && !csv.disabled) {
    if (csv.innerButtons) failures.push('CSVの欄に別の選択ボタンがある')
    if (csv.hintLines !== 3) failures.push('CSVの欄の説明が3行でない')
    if (!csv.disabled && (!csv.focusable || csv.role !== 'button')) failures.push('CSVの欄をキー操作できない')
    if (Number(csv.titleWeight) < 600 || !csv.hasUploadIcon) failures.push('CSVを追加の太字または上向きの印が無い')
  }
  const summary = [...document.querySelectorAll('[data-part="create-summary"]')].find(element => element.querySelector('h2')?.textContent === '出すときの決めごと')
  const list = summary?.querySelector('ul')
  const rules = visible(summary) ? { items: list?.querySelectorAll(':scope > li').length ?? 0, marker: list ? getComputedStyle(list).listStyleType : 'none' } : null
  if (rules && (rules.items !== 5 || rules.marker === 'none')) failures.push('掲載の決めごとが印付きの5項目でない')
  const publications = document.querySelector('[data-design-node="SyQA1"]')
  const kpiHelp = publications ? publications.querySelectorAll('[data-kpi-label] button').length : null
  if (kpiHelp) failures.push('投稿の数の題に余分な説明ボタンがある')
  return { csv, rules, rulesCollapsed: Boolean(summary && !visible(summary)), kpiHelp, failures }
}
