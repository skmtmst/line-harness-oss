/** Regression test against a production export and the unchanged 2,000-record API fixture. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { friendsTableReady, snapshotFriendsTable } from './friends-table-state.mjs'
import { assertStressResponse, installStressApi, waitForScreenReady } from '../../apps/web/scripts/v8-guard/speed-budget.mjs'

const [base = 'http://127.0.0.1:4388', out = '/tmp/lh-speed2-browser'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const cpuRate = Number(process.env.FRIENDS_TABLE_CPU_RATE ?? 1)
assert.ok(Number.isFinite(cpuRate) && cpuRate >= 1, 'CPU rate must be at least 1')
const browser = await chromium.launch()
let activePage = null
let stage = 'launch'
let activeWidth = null
const consoleMessages = []
const stages = []
const mark = (name) => { stage = name; stages.push({ width: activeWidth, stage, at: Date.now() }) }
const results = []
try {
  for (const width of [1440, 1152, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    activePage = page
    activeWidth = width
    page.on('console', message => consoleMessages.push({ width, type: message.type(), text: message.text() }))
    page.on('pageerror', error => consoleMessages.push({ width, type: 'pageerror', text: error.message }))
    if (cpuRate !== 1) {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
    }
    mark('navigation')
    await page.addInitScript(() => {
      localStorage.setItem('lh_csrf', 'visual-qa-csrf')
      localStorage.setItem('lh_selected_account', 'visual-qa-account')
      localStorage.setItem('lh_auth_selection_cleared', '1')
      localStorage.setItem('lh_staff_role', 'owner')
    })
    const response = await installStressApi(page, { stub: false })
    await page.goto(`${base}/friends`, { waitUntil: 'networkidle' })
    mark('screen-ready: API records and loaded friends')
    await waitForScreenReady(page, '/friends', 2000)
    assert.equal(assertStressResponse(response), 2000)
    await page.evaluate(() => document.fonts.ready)
    // Await measured geometry, not exact floating-point equality. Chromium can
    // retain a 1/16px table remainder indefinitely even when every row is 60px.
    mark('measured-height: bounded rows and total height within 1/8 CSS px')
    const initial = await snapshotFriendsTable(page)
    assert.equal(initial.rows, 2000)
    assert.ok(initial.rendered > 0 && initial.rendered < 60)
    const counts = []
    for (const [label, index] of [['top', 0], ['middle', 1000], ['bottom', 1999]]) {
      mark(`scroll-${label}: row ${index} and measured window`)
      await page.evaluate((index) => {
        const main = document.querySelector('main')
        const body = main.querySelector('tbody[data-virtual-table]')
        const offset = body.getBoundingClientRect().top + main.scrollTop - main.getBoundingClientRect().top
        main.scrollTop = offset + index * (body.getBoundingClientRect().height / 2000)
      }, index)
      await page.locator(`[data-table-index="${index}"]`).waitFor({ state: 'attached' })
      const geometry = await snapshotFriendsTable(page, { targetIndex: index })
      await page.screenshot({ path: join(out, `${width}-${label}.png`) })
      console.log(width, label, JSON.stringify(geometry))
      assert.ok(Math.abs(geometry.height - initial.height) <= 1 / 8, 'scrolling preserves total height within native-table rounding')
      assert.ok(geometry.rendered > 0 && geometry.rendered < 60)
      assert.equal(geometry.pageX, false)
      assert.equal(geometry.tableX, false)
      assert.equal(geometry.outside, 0)
      assert.equal(geometry.missingNames, 0)
      counts.push({ label, ...geometry })
    }
    mark('selection and unmount')
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
    mark('retained focus after far jump')
    // A far jump must retain just the focused row, not every intervening row.
    await checkbox.focus()
    await page.evaluate(() => { document.querySelector('main').scrollTop = 0 })
    await page.waitForFunction(friendsTableReady, { targetIndex: 0, focusedIndex: 1999 })
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-table-index]')?.dataset.tableIndex), '1999')
    assert.ok(await page.locator('[data-friend-row]').count() < 60)
    mark('keyboard backwards across rendered window')
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
} catch (error) {
  const state = await activePage?.evaluate(() => {
    const body = document.querySelector('tbody[data-virtual-table]')
    const rows = [...(body?.querySelectorAll('[data-friend-row]') ?? [])]
    const height = rows[0]?.getBoundingClientRect().height
    return {
      rowCount: Number(body?.dataset.rowCount), rendered: rows.length,
      indices: rows.map(row => Number(row.dataset.tableIndex)),
      rowHeights: [...new Set(rows.map(row => row.getBoundingClientRect().height))],
      bodyHeight: body?.getBoundingClientRect().height, expectedHeight: Number(body?.dataset.rowCount) * height,
      delta: body?.getBoundingClientRect().height - Number(body?.dataset.rowCount) * height,
      scrollTop: document.querySelector('main')?.scrollTop,
      focusedIndex: document.activeElement?.closest('[data-table-index]')?.dataset.tableIndex,
    }
  }).catch(() => null)
  await activePage?.screenshot({ path: join(out, 'failure.png'), timeout: 5000 }).catch(() => {})
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ stage, width: activeWidth, cpuRate, error: error.stack, state, consoleMessages, stages }, null, 2) + '\n')
  throw error
} finally {
  await browser.close()
  writeFileSync(join(out, 'diagnostics.json'), JSON.stringify({ cpuRate, consoleMessages, stages }, null, 2) + '\n')
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
}
console.log(JSON.stringify(results))
