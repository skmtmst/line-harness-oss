import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { assessBarChartLayout } from './bar-chart-layout-browser.mjs'

const chart = () => ({ line: 100, legendPresent: true, bars: [
  { series: 'added', top: 40, bottom: 100, height: 60 },
  { series: 'removed', top: 100, bottom: 120, height: 20 },
  { series: 'removed', top: 100, bottom: 100, height: 0 },
], colors: { added: 'green', removed: 'gray', broadcast: 'blue', scenario: 'purple' },
  events: [{ kind: 'broadcast', color: 'blue' }, { kind: 'scenario', color: 'purple' }] })

test('基準線上下と凡例どおりの出来事は通る', () => {
  assert.equal(assessBarChartLayout(chart()), 0)
})
test('減少が基準線の上に戻ると落ちる', () => {
  const measured = chart()
  measured.bars[1] = { series: 'removed', top: 80, bottom: 100, height: 20 }
  assert.equal(assessBarChartLayout(measured), 1)
})
test('増加と配信日が同じ色へ戻ると落ちる', () => {
  const measured = chart()
  measured.colors.broadcast = 'green'
  measured.events[0].color = 'green'
  assert.equal(assessBarChartLayout(measured), 1)
})
test('日付の印だけが凡例と食い違うと落ちる', () => {
  const measured = chart()
  measured.events[0].color = 'purple'
  assert.equal(assessBarChartLayout(measured), 1)
})

test('凡例を見つけられない測定を0へしない', () => {
  const measured = chart()
  measured.legendPresent = false
  assert.equal(assessBarChartLayout(measured), 1)
})

test('色の変数が出力されず印が透明になったら落ちる', () => {
  const measured = chart()
  measured.colors.broadcast = 'rgba(0, 0, 0, 0)'
  measured.events[0].color = 'rgba(0, 0, 0, 0)'
  assert.equal(assessBarChartLayout(measured), 2)
})


const summaryItems = Array.from({ length: 7 }, (_, index) => ({
  key: `${index + 4}月`, label: `${index + 4}月`, value: (index + 1) * 1000,
}))
const dailyItems = Array.from({ length: 30 }, (_, index) => ({
  key: `2026-09-${String(index + 1).padStart(2, '0')}`,
  label: `2026-09-${String(index + 1).padStart(2, '0')}`,
  value: index === 1 ? null : index * 10,
}))
let fixturePromise
function valueBarFixture() {
  fixturePromise ??= (async () => {
    const webRoot = fileURLToPath(new URL('../..', import.meta.url))
    const require = createRequire(import.meta.url)
    const fromVitest = createRequire(require.resolve('vitest/package.json'))
    const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')
    const compiled = await build({
      stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {ValueBarChart} from './src/components/shared/charts';
        import {BarChart, toBarChartItems} from './src/components/shared/bar-chart';
        createRoot(document.getElementById('root')).render(<main>
          <section data-chart-fixture="summary"><ValueBarChart label="月ごとの売上" presentation="summary" unit="円" items={${JSON.stringify(summaryItems)}}/></section>
          <section data-chart-fixture="standard"><ValueBarChart label="日ごとの数" unit="件" items={${JSON.stringify(dailyItems)}}/></section>
          {[7,31,90].map(count => <section key={count} data-friend-chart-fixture={count}>
            <BarChart distribution="diverging" items={toBarChartItems(Array.from({length:count},(_,index)=>({
              date:new Date(Date.UTC(2026,9,15+index)).toISOString().slice(0,10),added:index%9+1,removed:index%4,
            })))}/>
          </section>)}
          <section data-friend-chart-fixture="dashboard"><BarChart layout="dashboard" items={toBarChartItems(Array.from({length:7},(_,index)=>({
            date:new Date(Date.UTC(2026,9,15+index)).toISOString().slice(0,10),added:index+2,removed:index%3,
          })),{formatAxisLabel:date=>date.slice(5).replace('-','/')+'（木）'})}/></section>
        </main>);
      ` },
      bundle: true, write: false, outdir: resolve(webRoot, '.value-bar-fixture-output'),
      platform: 'browser', format: 'iife', jsx: 'automatic',
      tsconfig: resolve(webRoot, 'tsconfig.json'),
      define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:8788"' },
      plugins: [{ name: 'value-bar-navigation-only', setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
        builder.onResolve({ filter: /^next\/link$|^@\/components\/shared\/list-navigation$|\/list-navigation$|^\.\/list-navigation$/ }, () => ({ path: 'link', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: path === 'navigation'
            ? 'export const useRouter=()=>({push(){},replace(){},prefetch(){}});export const usePathname=()=>"/";export const useSearchParams=()=>new URLSearchParams();'
            : 'import React from "react";export default function Link(p){return React.createElement("a",p)};export const RowNavigation=Link;export const useListNavigationHref=()=>"/";',
          resolveDir: webRoot,
        }))
      } }],
    })
    // esbuild emits the real CSS Modules and their corresponding class names together.
    // Do not replace product selectors or manufacture utility styles in this fixture.
    const script = compiled.outputFiles.find(file => file.path.endsWith('.js'))
    const sheets = compiled.outputFiles.filter(file => file.path.endsWith('.css'))
    assert.ok(script && sheets.length > 0, '実コンポーネントとCSS Modulesの出力が必要')
    return { script: script.text, css: sheets.map(file => file.text).join('\n'),
      globals: await compileUiStyles(resolve(webRoot, 'src/app/globals.css')) }
  })()
  return fixturePromise
}

function healthyValueAxes(rows) {
  return rows.length === 2 && rows[0].kind === 'summary' && rows[1].kind === 'standard' && rows.every(row => {
    const items = row.kind === 'summary' ? summaryItems : row.kind === 'standard' ? dailyItems : []
    if (!items.length || row.columns.length !== items.length || !row.styled) return false
    if (!row.columns.every((column, index) => column && column.text === (row.kind === 'summary' ? items[index].label : `9/${index + 1}`)
      && column.aria === `${items[index].label} ${items[index].value === null ? '—' : items[index].value.toLocaleString('ja-JP') + (row.kind === 'summary' ? '円' : '件')}`
      && column.bar.width > 0 && column.axisPosition === 'absolute' && column.whiteSpace === 'nowrap')) return false
    if (!row.columns[0].visible || !row.columns.at(-1).visible) return false
    if (row.columns[0].axis.left < row.bounds.left - 1
      || row.columns.at(-1).axis.right > row.bounds.right + 1) return false
    if (row.kind === 'summary') return row.columns.filter(column => column.visible)
      .every(column => Math.abs(column.axis.center - column.bar.center) <= 1)
    return row.columns.some(column => !column.visible)
  })
}

for (const width of [1152, 1440]) {
  test(`ValueBarChartの月名中央と通常端軸を正規CSSで守る ${width}`, async () => {
    const fixture = await valueBarFixture()
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.setContent(`<html data-theme="v8"><style>${fixture.globals}</style><style>${fixture.css}</style>
        <style>body{margin:0}main{padding:24px}section{width:${width === 1152 ? 280 : 520}px;margin-bottom:48px}[data-friend-chart-fixture]{width:720px}</style><div id="root"></div></html>`)
      await page.addScriptTag({ content: fixture.script })
      await expect(page.locator('[data-chart-fixture] [role=group]')).toHaveCount(2).catch(error => {
        console.log(JSON.stringify({ width, phase: 'render-failed', errors }))
        throw error
      })
      await page.evaluate(() => document.fonts.ready)
      assert.deepEqual(page.viewportSize(), { width, height: 900 })
      const measure = () => page.locator('[data-chart-fixture]').evaluateAll(sections => sections.map(section => {
        const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, center: (r.left + r.right) / 2 } }
        const plot = section.querySelector('[data-presentation]')
        const columns = plot?.querySelector(':scope > div')
        const plotStyle = plot && getComputedStyle(plot)
        return { kind: section.dataset.chartFixture,
          styled: !!(plot && columns && plotStyle.position === 'relative' && plot.getBoundingClientRect().height > 0
            && getComputedStyle(columns).display === 'flex'),
          bounds: columns ? rect(columns) : null,
          columns: columns ? [...columns.children].map(column => {
            const axis = column.querySelector(':scope > [data-chart-axis]')
            const button = column.querySelector(':scope > button')
            const bar = button?.firstElementChild
            if (!axis || !button || !bar) return null
            const style = getComputedStyle(axis)
            return { text: axis.textContent, aria: button.getAttribute('aria-label'),
              visible: !axis.hidden && style.display !== 'none', axis: rect(axis), bar: rect(bar),
              axisPosition: style.position, whiteSpace: style.whiteSpace }
          }) : [] }
      }))
      await expect.poll(async () => healthyValueAxes(await measure())).toBe(true)
      const normal = await measure()
      // Reintroduce exactly the old summary edge alignment, without changing the bars.
      const summaryFault = await page.addStyleTag({ content: `
        html:root [data-chart-fixture="summary"] [data-axis-edge="first"]{left:0!important;right:auto!important;transform:none!important}
        html:root [data-chart-fixture="summary"] [data-axis-edge="last"]{left:auto!important;right:0!important;transform:none!important}` })
      await expect.poll(async () => healthyValueAxes(await measure())).toBe(false)
      const brokenSummary = await measure()
      assert.equal(healthyValueAxes(brokenSummary), false)
      assert.ok(brokenSummary[0].columns.some(column => column.visible && Math.abs(column.axis.center - column.bar.center) > 1))
      assert.deepEqual(brokenSummary[1], normal[1])
      await summaryFault.evaluate(style => style.remove())
      await expect.poll(async () => healthyValueAxes(await measure())).toBe(true)
      const restoredSummary = await measure()
      assert.deepEqual(restoredSummary, normal)
      // Removing the standard edge protection must also fail the very same predicate.
      const standardFault = await page.addStyleTag({ content: `
        html:root [data-chart-fixture="standard"] [data-axis-edge]{left:50%!important;right:auto!important;transform:translateX(-50%)!important}` })
      await expect.poll(async () => healthyValueAxes(await measure())).toBe(false)
      const brokenStandard = await measure()
      assert.equal(healthyValueAxes(brokenStandard), false)
      assert.deepEqual(brokenStandard[0], normal[0])
      assert.ok(brokenStandard[1].columns[0].axis.left < brokenStandard[1].bounds.left - 1
        || brokenStandard[1].columns.at(-1).axis.right > brokenStandard[1].bounds.right + 1)
      await standardFault.evaluate(style => style.remove())
      await expect.poll(async () => healthyValueAxes(await measure())).toBe(true)
      const restoredStandard = await measure()
      assert.deepEqual(restoredStandard, normal)
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ width, normal, brokenSummary, restoredSummary, brokenStandard, restoredStandard, errors }))
    } finally { await browser.close() }
  })
}


function dateCoversTick(row) {
  return row.labels.some(label => row.ticks.some(tick => label.box.left < tick.right && label.box.right > tick.left
    && label.box.top < tick.bottom && label.box.bottom > tick.top))
}

function healthyDateAxes(rows) {
  return rows.length === 4 && rows.every(row => row.ticks.length > 0 && !dateCoversTick(row)
    && row.labels.length > 0 && row.labels.every((label, index) =>
      label.text.length > 0 && label.whiteSpace === 'nowrap' && label.textOverflow !== 'ellipsis'
      && label.textBox.left >= label.box.left - 1 && label.textBox.right <= label.box.right + 1
      && label.textBox.left >= row.bounds.left - 1 && label.textBox.right <= row.bounds.right + 1
      && label.box.left >= row.plot.left - 1
      && (index === 0 || label.textBox.left >= row.labels[index - 1].textBox.right + 1)))
}

for (const width of [1152, 1440]) {
  test(`BarChartの日付は文字が箱に収まり隣と重ならない ${width}`, async () => {
    const fixture = await valueBarFixture()
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 1128 }, reducedMotion: 'reduce' })
      await page.setContent(`<html data-theme="v8"><style>${fixture.globals}</style><style>${fixture.css}</style>
        <style>body{margin:0}main{padding:24px}section{width:${width === 1152 ? 800 : 744}px;margin-bottom:56px}</style><div id="root"></div></html>`)
      await page.addScriptTag({ content: fixture.script })
      await expect(page.locator('[data-friend-chart-fixture]')).toHaveCount(4)
      await page.evaluate(() => document.fonts.ready)
      const measure = () => page.locator('[data-friend-chart-fixture]').evaluateAll(sections => sections.map(section => {
        const rect = element => { const r = element.getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom} }
        const plot = section.querySelector('[role=group]')
        return { kind:section.dataset.friendChartFixture, bounds:rect(section), plot:rect(plot),
          ticks:[...plot.querySelectorAll('[aria-hidden=true] > span')].filter(tick => /^-?\d+$/.test(tick.textContent.trim())).map(tick => {
            const range=document.createRange();range.selectNodeContents(tick);return rect(range)
          }),
          bars:[...plot.querySelectorAll('[data-chart-series]')].map(bar => rect(bar)),
          labels:[...plot.querySelectorAll('button')].flatMap(button => {
            const label = button.nextElementSibling
            if (!label) return []
            const range = document.createRange();range.selectNodeContents(label)
            const style = getComputedStyle(label)
            return [{text:label.textContent.trim(),box:rect(label),textBox:rect(range),
              whiteSpace:style.whiteSpace,textOverflow:style.textOverflow}]
          }) }
      }))
      const normal = await measure()
      console.log(JSON.stringify({width,phase:'normal',rows:normal}))
      assert.equal(healthyDateAxes(normal), true, '日付全文・自身の箱・図の端・隣の文字・縦軸数字との非重複を同時に守る')
      const oldWidth = await page.addStyleTag({content:`[data-chart-distribution="diverging"] button+span{width:100%!important;min-width:0!important;left:0!important;transform:none!important}`})
      await expect.poll(async () => healthyDateAxes(await measure())).toBe(false)
      const broken = await measure()
      assert.equal(healthyDateAxes(broken), false, '旧来の列幅へ戻すと同じ測定で落ちる')
      assert.deepEqual(broken.at(-1),normal.at(-1),'dashboardには故障も修復も波及しない')
      for (let i=0;i<normal.length;i++) assert.deepEqual(broken[i].bars,normal[i].bars,'棒の幅・位置を変えない')
      await oldWidth.evaluate(style => style.remove())
      await expect.poll(measure).toEqual(normal)
      console.log(JSON.stringify({width,phase:'old-width-fault',rows:broken,restored:true}))
      // Reduced motion still uses a nonzero transition; wait for the injected geometry.
      const centeredEdge = await page.addStyleTag({content:`[data-chart-distribution="diverging"] [role=group] > :last-child > :first-child > button+span{left:50%!important;transform:translateX(-50%)!important}`})
      await expect.poll(async () => (await measure()).some(dateCoversTick)).toBe(true)
      const covered = await measure()
      assert.equal(healthyDateAxes(covered),false,'中央へ広げた先頭の日付が縦軸を隠す旧版を検出する')
      assert.deepEqual(covered.at(-1),normal.at(-1),'dashboardには先頭日付の故障も波及しない')
      assert.ok(covered.some(dateCoversTick),'日付の箱と縦軸数字の実矩形が重なる')
      for (let i=0;i<normal.length;i++) assert.deepEqual(covered[i].bars,normal[i].bars)
      await centeredEdge.evaluate(style => style.remove())
      await expect.poll(measure).toEqual(normal)
      console.log(JSON.stringify({width,phase:'centered-edge-fault',rows:covered,restored:true}))
    } finally { await browser.close() }
  })
}
