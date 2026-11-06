import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './date-group-browser.mjs'

for (const width of [1152, 1440]) {
  test(`日付の文字は行の中央に置き、位置・重複・間延びの故障を検出して復元する（${width}）`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.setContent(`<main><div role="table" aria-label="日付の見張り"><div role="row" data-table-date-group="2026-08-14" style="display:flex;align-items:center;box-sizing:border-box;height:52px;padding:8px 16px;font:14px/18px sans-serif"><span role="cell">8月14日（金）</span></div><div role="row" style="height:52px"><span role="cell">時刻</span><span role="cell">内容</span></div></div></main>`)
      const healthy = await page.evaluate(scan)
      assert.deepEqual(healthy.findings, [])
      assert.equal(healthy.coverage[0].groups.length, 1)
      await page.locator('[data-table-date-group]').evaluate(row => { row.style.display = 'block' })
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-table-date-group]')).display === 'block')
      assert.ok((await page.evaluate(scan)).findings.some(x => x.kind === 'date-group-offcenter'))
      await page.locator('[data-table-date-group]').evaluate(row => { row.style.display = 'flex' })
      assert.deepEqual((await page.evaluate(scan)).findings, [])
      await page.locator('[data-table-date-group]').evaluate(row => { row.after(row.cloneNode(true)) })
      assert.ok((await page.evaluate(scan)).findings.some(x => x.kind === 'date-group-duplicate'))
      await page.locator('[data-table-date-group]').nth(1).evaluate(row => row.remove())
      await page.locator('[data-table-date-group]').evaluate(row => { row.style.height = '104px' })
      assert.ok((await page.evaluate(scan)).findings.some(x => x.kind === 'date-group-too-tall'))
      await page.locator('[data-table-date-group]').evaluate(row => { row.style.height = '52px' })
      assert.deepEqual(await page.evaluate(scan), healthy)
      // Native table consumers and year-qualified keys have the same contract.
      await page.setContent('<main><table><tbody><tr data-table-date-group="2026-08-14" style="height:40px"><td colspan="2" style="vertical-align:middle">8月14日（金）</td></tr><tr style="height:52px"><td>時刻</td><td>内容</td></tr><tr data-table-date-group="2025-08-14" style="height:40px"><td colspan="2" style="vertical-align:middle">8月14日（木）</td></tr></tbody></table></main>')
      assert.deepEqual((await page.evaluate(scan)).findings, [])
      assert.equal((await page.evaluate(scan)).coverage[0].groups.length, 2)
    } finally { await browser.close() }
  })
}
