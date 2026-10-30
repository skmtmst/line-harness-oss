import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './coupon-preview-browser.mjs'

test('long coupon cards scroll to their action; flex shrinking that hides it fails and restoration passes', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<div style="display:flex;flex-direction:column;width:300px;height:200px;overflow-y:auto"><article data-coupon-preview-state="ready" style="flex-shrink:0;overflow:hidden"><div style="height:300px">ガイド</div><button>クーポンを使用する</button></article></div>')
    assert.deepEqual(await page.evaluate(scan), [])
    await page.locator('article').evaluate(card => { card.style.flexShrink = '1' })
    assert.equal((await page.evaluate(scan))[0]?.kind, 'coupon-action-clipped')
    await page.locator('article').evaluate(card => { card.style.flexShrink = '0' })
    assert.deepEqual(await page.evaluate(scan), [])
  } finally { await browser.close() }
})
