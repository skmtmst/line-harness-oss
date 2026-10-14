import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { connectGuardBrowser } from '../../apps/web/scripts/v8-guard/browser-session.mjs'
import { friendsTableReady } from './friends-table-state.mjs'

let browser
before(async () => { browser = await connectGuardBrowser() })
after(async () => { await browser?.close() })
async function fixture(delta = 0, count = 2000, rendered = 12) {
  const page = await browser.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.setContent(`<table style="border-spacing:0"><tbody data-virtual-table data-row-count="${count}">
    ${Array.from({ length: rendered }, (_, i) => `<tr data-friend-row data-table-index="${i}"><td style="padding:0;height:60px"><button>row ${i}</button></td></tr>`).join('')}
    <tr aria-hidden="true"><td style="padding:0;height:${(2000 - rendered) * 60 + delta}px"></td></tr>
  </tbody></table>`)
  return page
}

test('a stable 1/16px table remainder does not wait forever; one whole pixel still fails', async () => {
  for (const delta of [-1 / 16, 0, 1 / 16]) {
    const page = await fixture(delta)
    try {
      const state = await page.evaluate(() => {
        const body = document.querySelector('tbody')
        const height = body.querySelector('[data-friend-row]').getBoundingClientRect().height
        return { height, total: body.getBoundingClientRect().height }
      })
      assert.equal(state.height, 60)
      assert.equal(state.total, 120000 + delta)
      if (delta) {
        assert.notEqual(state.total, 2000 * state.height, 'the old exact-equality predicate would never finish')
        await assert.rejects(() => page.waitForFunction(() => {
          const body = document.querySelector('tbody')
          return body.getBoundingClientRect().height === 2000 * body.querySelector('[data-friend-row]').getBoundingClientRect().height
        }, {}, { timeout: 200 }), /Timeout/)
      }
      await page.waitForFunction(friendsTableReady, {}, { timeout: 2000 })
    } finally { await page.close() }
  }
  for (const delta of [-1, 1, 60]) {
    const page = await fixture(delta)
    try { assert.equal(await page.evaluate(friendsTableReady, {}), false) }
    finally { await page.close() }
  }
})

test('waits for the actual measured spacer and requested row/focus; rejects incomplete or unbounded windows', async () => {
  const page = await fixture(-2000)
  try {
    assert.equal(await page.evaluate(friendsTableReady, {}), false)
    await page.evaluate(() => requestAnimationFrame(() => {
      document.querySelector('tr[aria-hidden] td').style.height = `${(2000 - 12) * 60}px`
    }))
    await page.waitForFunction(friendsTableReady, { targetIndex: 11 }, { timeout: 2000 })
    assert.equal(await page.evaluate(friendsTableReady, { targetIndex: 1999 }), false)
    assert.equal(await page.evaluate(friendsTableReady, { focusedIndex: 11 }), false)
    await page.locator('[data-table-index="11"] button').focus()
    assert.equal(await page.evaluate(friendsTableReady, { focusedIndex: 11 }), true)
    await page.locator('[data-table-index="11"]').evaluate(row => { row.dataset.tableIndex = '0' })
    assert.equal(await page.evaluate(friendsTableReady, {}), false)
  } finally { await page.close() }
  for (const [count, rendered] of [[1999, 12], [2000, 60], [2000, 0]]) {
    const page = await fixture(0, count, rendered)
    try { assert.equal(await page.evaluate(friendsTableReady, {}), false) }
    finally { await page.close() }
  }
})
