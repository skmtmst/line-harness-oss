/** Regression test against a production export and the unchanged 2,000-record API fixture. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { assertStressResponse, installStressApi, waitForScreenReady } from '../../apps/web/scripts/v8-guard/speed-budget.mjs'

const [base = 'http://127.0.0.1:4388', out = '/tmp/lh-speed2-browser'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const results = []
try {
  for (const width of [1440, 1152, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.addInitScript(() => {
      localStorage.setItem('lh_csrf', 'visual-qa-csrf')
      localStorage.setItem('lh_selected_account', 'visual-qa-account')
      localStorage.setItem('lh_auth_selection_cleared', '1')
      localStorage.setItem('lh_staff_role', 'owner')
    })
    const response = await installStressApi(page, { stub: false })
    await page.goto(`${base}/friends`, { waitUntil: 'networkidle' })
    await waitForScreenReady(page, '/friends', 2000)
    assert.equal(assertStressResponse(response), 2000)
    await page.evaluate(() => document.fonts.ready)
    // The uniform fixture must finish ResizeObserver measurement before its height is the reference.
    // A fixed delay can capture a transient 1/16px spacer correction under parallel CI load.
    await page.waitForFunction(() => {
      const body = document.querySelector('tbody[data-virtual-table]')
      const rows = [...body.querySelectorAll('[data-friend-row]')]
      const height = rows[0]?.getBoundingClientRect().height
      return height > 0 && rows.every(row => row.getBoundingClientRect().height === height)
        && body.getBoundingClientRect().height === Number(body.dataset.rowCount) * height
    })
    const initial = await page.evaluate(() => {
      const body = document.querySelector('tbody[data-virtual-table]')
      return { rows: Number(body.dataset.rowCount), height: body.getBoundingClientRect().height, rendered: body.querySelectorAll('[data-friend-row]').length }
    })
    assert.equal(initial.rows, 2000)
    assert.ok(initial.rendered > 0 && initial.rendered < 60)
    const counts = []
    for (const [label, index] of [['top', 0], ['middle', 1000], ['bottom', 1999]]) {
      await page.evaluate((index) => {
        const main = document.querySelector('main')
        const body = main.querySelector('tbody[data-virtual-table]')
        const offset = body.getBoundingClientRect().top + main.scrollTop - main.getBoundingClientRect().top
        main.scrollTop = offset + index * (body.getBoundingClientRect().height / 2000)
      }, index)
      await page.locator(`[data-table-index="${index}"]`).waitFor({ state: 'attached' })
      await page.waitForTimeout(250)
      const geometry = await page.evaluate(() => {
        const main = document.querySelector('main')
        const body = main.querySelector('tbody[data-virtual-table]')
        const rows = [...body.querySelectorAll('[data-friend-row]')]
        const mainBox = main.getBoundingClientRect()
        return {
          height: body.getBoundingClientRect().height, rendered: rows.length,
          tableRight: body.getBoundingClientRect().right, mainRight: mainBox.right,
          missingNames: rows.filter((row) => row.querySelector('a[title]')?.getBoundingClientRect().width < 30).length,
          rowHeights: [...new Set(rows.map((row) => row.getBoundingClientRect().height))],
          pageX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          tableX: body.closest('table').scrollWidth > body.closest('table').clientWidth,
          outside: rows.filter((row) => row.getBoundingClientRect().right > mainBox.right + 1).length,
        }
      })
      await page.screenshot({ path: join(out, `${width}-${label}.png`) })
      console.log(width, label, JSON.stringify(geometry))
      assert.equal(geometry.height, initial.height)
      assert.ok(geometry.rendered > 0 && geometry.rendered < 60)
      assert.equal(geometry.pageX, false)
      assert.equal(geometry.tableX, false)
      assert.equal(geometry.outside, 0)
      assert.equal(geometry.missingNames, 0)
      counts.push({ label, ...geometry })
    }
    const last = page.locator('[data-table-index="1999"]')
    const checkbox = last.getByRole('checkbox')
    await last.locator('label').first().click()
    await assert.doesNotReject(() => checkbox.waitFor({ state: 'visible' }))
    assert.equal(await last.getAttribute('aria-selected'), 'true')
    await page.evaluate(() => { document.activeElement.blur(); document.querySelector('main').scrollTop = 0 })
    await last.waitFor({ state: 'detached', timeout: 5000 })
    await page.evaluate(() => { const main = document.querySelector('main'); main.scrollTop = main.scrollHeight })
    await last.waitFor({ state: 'visible' })
    assert.equal(await checkbox.isChecked(), true)
    await checkbox.focus()
    await page.keyboard.press('Space')
    assert.equal(await checkbox.isChecked(), false)
    await last.getByRole('button', { name: /その他操作/ }).click()
    await page.getByRole('menu').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    // A far jump must retain just the focused row, not every intervening row.
    await checkbox.focus()
    await page.evaluate(() => { document.querySelector('main').scrollTop = 0 })
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-table-index]')?.dataset.tableIndex), '1999')
    assert.ok(await page.locator('[data-friend-row]').count() < 60)
    // Walk backwards past the edge of the rendered window; rows must not be skipped.
    await checkbox.focus()
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('Shift+Tab')
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    }
    const focusedIndex = await page.evaluate(() => Number(document.activeElement.closest('[data-table-index]')?.dataset.tableIndex ?? -1))
    assert.ok(focusedIndex >= 0 && focusedIndex < 1980)
    assert.ok(await page.locator('[data-friend-row]').count() < 60)
    results.push({ width, initial, counts, selection: true, selectionAfterUnmount: true, keyboard: true, keyboardAcrossWindow: true, menu: true, focusRetained: true })
    await page.close()
  }
} finally {
  await browser.close()
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
}
console.log(JSON.stringify(results))
