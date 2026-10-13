import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'

export function assessBarChartLayout(chart) {
  const misplaced = chart.bars.filter(bar => chart.line === null || (bar.height > 0 && (bar.series === 'added' ? bar.bottom > chart.line + 1 : bar.top < chart.line - 1))).length
  const transparent = color => !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
  const mismatch = chart.events.filter(event => transparent(event.color) || !chart.colors[event.kind] || chart.colors[event.kind] !== event.color).length
  const unpainted = Object.values(chart.colors).filter(transparent).length
  const duplicateColor = chart.colors.added && chart.colors.broadcast && chart.colors.added === chart.colors.broadcast ? 1 : 0
  return misplaced + mismatch + duplicateColor + unpainted + (chart.legendPresent === false ? 1 : 0)
}

export function inspectBarCharts() {
  const rect = element => element.getBoundingClientRect()
  return [...document.querySelectorAll('[data-chart-distribution="diverging"]')].map(chart => {
    const baseline = chart.querySelector('[data-chart-baseline]')
    const line = baseline ? rect(baseline).top : null
    const bars = [...chart.querySelectorAll('[data-chart-series]')].map(bar => {
      const box = rect(bar), series = bar.dataset.chartSeries
      return { series, height: box.height, top: box.top, bottom: box.bottom }
    })
    const legend = chart.querySelector('[aria-label="凡例"]') ?? (chart.previousElementSibling?.matches('[aria-label="凡例"]') ? chart.previousElementSibling : null)
    const colors = Object.fromEntries([...(legend ?? chart).querySelectorAll('[data-chart-tone]')].map(mark => [mark.dataset.chartTone, getComputedStyle(mark).backgroundColor]))
    const events = [...chart.querySelectorAll('[data-chart-event]')].map(mark => ({ kind: mark.dataset.chartEvent, color: getComputedStyle(mark).backgroundColor }))
    return { line, bars, colors, events, legendPresent: Boolean(legend) }
  })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [url, output] = process.argv.slice(2)
  if (!url) throw Error('URLを指定してください')
  const browser = await chromium.launch(), results = []
  try {
    for (const width of [1440, 1152, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 1128 }, reducedMotion: 'reduce' })
      await page.goto(url)
      await page.evaluate(() => document.fonts.ready)
      const charts = (await page.evaluate(inspectBarCharts)).map(chart => ({ ...chart, failures: assessBarChartLayout(chart) }))
      results.push({ width, charts, failures: charts.length ? charts.reduce((sum, chart) => sum + chart.failures, 0) : null })
      await page.close()
    }
  } finally { await browser.close() }
  if (output) writeFileSync(output, JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results.map(({ width, failures }) => ({ width, failures }))))
  if (results.some(result => result.failures === null || result.failures > 0)) process.exitCode = 1
}
