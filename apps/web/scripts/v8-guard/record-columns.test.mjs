import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import { fitListColumns } from '../../src/components/shared/list-column-sizing.mjs'
import scanColumns from './table-column-alignment-browser.mjs'
import scanLayout from './layout-defects-browser.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = path => read(path).replace(/:global\(([^)]+)\)/g, '$1')

test('record tracks align all four columns and detect the former stacked layout at every desktop width', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<html><style>${read('../../src/app/globals.css')}${css('../../src/components/shared/data-table.module.css')}${css('../../src/components/shared/table.module.css')}
        *{box-sizing:border-box}.frame{width:calc(100vw - 660px)}.badge{display:inline-flex;padding:2px 8px;white-space:nowrap}td[data-cell-grow]{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        </style><main><div class="frame" data-table-density="records" data-column-sizing="content" style="--table-columns:repeat(4,minmax(0,1fr))"><table class="table" aria-label="同期の記録"><thead><tr class="headRow"><th class="cell">日時</th><th class="cell">きっかけ</th><th class="cell" data-cell-grow>書き出したもの</th><th class="cell">結果</th></tr></thead><tbody>${['9/30 03:00', '9/29 15:42'].map(date => `<tr class="row"><td class="bodyCell">${date}</td><td class="bodyCell">定期</td><td class="bodyCell" data-cell-grow>友だち 1,284・フォーム回答 312</td><td class="bodyCell"><span class="badge" data-design-node="xRvDB">一部だけ完了</span></td></tr>`).join('')}</tbody></table></div></main></html>`)
      await page.locator('.frame').evaluate(fitListColumns)
      const good = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('tr')].map(row => [...row.children].map(cell => {
          const box = cell.getBoundingClientRect()
          return { x: box.x, width: box.width, top: box.top, bottom: box.bottom }
        }))
        return { rows, overflow: document.documentElement.scrollWidth - innerWidth }
      })
      const alignment = await page.evaluate(scanColumns)
      assert.equal(alignment.findings.length, 0)
      assert.equal(alignment.coverage[0].rows, 3, 'head and both data rows must actually be measured')
      assert.equal(good.overflow, 0)
      for (const row of good.rows.slice(1)) for (const [index, cell] of row.entries()) {
        assert.ok(Math.abs(cell.x - good.rows[0][index].x) < 1, JSON.stringify({ width, good }))
        assert.ok(Math.abs(cell.width - good.rows[0][index].width) < 1)
      }
      for (let repeat = 0; repeat < 5; repeat++) await page.locator('.frame').evaluate(fitListColumns)
      assert.equal((await page.evaluate(scanColumns)).findings.length, 0)
      await page.locator('.frame').evaluate(frame => {
        frame.style.removeProperty('--table-columns')
        frame.style.removeProperty('--table-content-columns')
      })
      assert.ok((await page.evaluate(scanColumns)).findings.length > 0, 'the missing-track fault must be detected')
    }
  } finally { await browser.close() }
})


test('late calendar data refreshes flex column widths and keeps every row aligned', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>${read('../../src/app/globals.css')}${css('../../src/components/shared/data-table.module.css')}${css('../../src/components/shared/table.module.css')}
        *{box-sizing:border-box}.frame{width:calc(100vw - 280px)}.table tr{display:flex}.table tr>th,.table tr>td{flex:0 1 auto;white-space:nowrap}.calendar{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        </style><main><div class="frame" data-column-layout data-column-sizing="content" style="--table-column-gap:12px;--table-column-padding:0 24px;--table-head-padding:0 24px;--table-head-height:40px;--table-row-height:56px"><table class="table"><thead><tr data-table-layout="columns"><th data-cell-grow>スタッフ</th><th>カレンダー</th><th>状態</th></tr></thead><tbody>${['高田 誠', '中川 由美'].map(name => `<tr data-table-layout="columns"><td data-cell-grow>${name}</td><td><span class="calendar">—</span></td><td>つながっている</td></tr>`).join('')}</tbody></table></div></main>`)
      await page.locator('.frame').evaluate(fitListColumns)
      const before = await page.locator('tbody tr').first().locator('td').nth(1).evaluate(cell => cell.getBoundingClientRect().width)
      await page.locator('tbody .calendar').evaluateAll(nodes => nodes.forEach(node => { node.textContent = 'takada@nen-salon.jp' }))
      await page.locator('.frame').evaluate(fitListColumns)
      const after = await page.locator('tbody tr').first().locator('td').nth(1).evaluate(cell => cell.getBoundingClientRect().width)
      assert.ok(after > before, `late value must grow its column: ${before} -> ${after}`)
      const clipping = await page.locator('tbody .calendar').evaluateAll(nodes => nodes.some(node => node.scrollWidth > node.clientWidth + 1))
      assert.equal(clipping, false, `calendar is readable at ${width}`)
      const positions = await page.locator('tr').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.getBoundingClientRect().x)))
      for (const row of positions.slice(1)) for (const [index, x] of row.entries()) assert.ok(Math.abs(x - positions[0][index]) <= 1)
      for (let repeat = 0; repeat < 3; repeat++) await page.locator('.frame').evaluate(fitListColumns)
      assert.equal(await page.locator('tbody tr').first().locator('td').nth(1).evaluate(cell => cell.getBoundingClientRect().width), after)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    }
  } finally { await browser.close() }
})
