import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './pendec2-rules-browser.mjs'

test('card spill is detected only when its content is visible, and restoration is clean', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><details><summary>設定</summary><section data-design-part="card" style="width:100px;border:1px solid"><div style="width:300px">本文</div></section></details></main>')
    assert.deepEqual(await page.evaluate(scan),[])
    await page.locator('details').evaluate(el=>{el.open=true})
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='cardspill'))
    await page.locator('section > div').evaluate(el=>{el.style.width='auto'})
    assert.deepEqual(await page.evaluate(scan),[])
  } finally { await browser.close() }
})
test('segmented choice has one selected option and every action has a name', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><div data-segmented-control><button aria-pressed="true">開始</button><button aria-pressed="false">停止</button></div></main>')
    assert.deepEqual(await page.evaluate(scan),[])
    await page.locator('button').last().evaluate(el=>el.setAttribute('aria-pressed','true'))
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='segselected'))
    await page.locator('button').last().evaluate(el=>{el.setAttribute('aria-pressed','false');el.textContent=''})
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='segempty'))
    await page.locator('button').last().evaluate(el=>el.setAttribute('aria-label','停止'))
    assert.deepEqual(await page.evaluate(scan),[])
  } finally { await browser.close() }
})
