import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './store-compare-layout-browser.mjs'

test('店の比較の差札が値に重なると落ち、離すと通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><span class="list_cell__x" style="display:inline-flex;position:relative;gap:8px"><span>12345</span><span class="delta-chip_root__x" style="position:absolute;left:0;top:0">+3</span></span></main>')
    assert.ok((await page.evaluate(scan)).some(f => f.kind === 'store-compare-delta-overlap'))
    await page.locator('[class*="delta-chip_root__"]').evaluate(el => { el.style.position = 'static'; el.style.marginLeft = '8px' })
    assert.deepEqual(await page.evaluate(scan), [])
  } finally { await browser.close() }
})
