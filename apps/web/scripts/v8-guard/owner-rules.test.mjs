import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './owner-rules-browser.mjs'

test('a framed box clipped by its parent fails; scrollable and restored boxes remain usable', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const body = '<main><div id="parent" style="height:80px;overflow:hidden"><section style="width:160px;height:160px;border:1px solid">本文</section></div></main>'
    await page.setContent(body)
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='boxclip'))
    await page.locator('#parent').evaluate(el=>{el.style.overflowY='auto'})
    assert.deepEqual(await page.evaluate(scan),[])
    await page.locator('#parent').evaluate(el=>{el.style.height='auto';el.style.overflowY='hidden'})
    assert.deepEqual(await page.evaluate(scan),[])
  } finally { await browser.close() }
})

test('small UI text drawn at weight 400 fails; 500 and larger reading text pass', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<html data-theme="v8"><body><main><p id="small" style="font-size:12px;font-weight:500">補足の文字</p><p style="font-size:15px;font-weight:400">読み物の本文</p></main></body></html>')
    assert.deepEqual(await page.evaluate(scan), [])
    await page.locator('#small').evaluate(el => { el.style.fontWeight = '400' })
    const broken = await page.evaluate(scan)
    assert.equal(broken.length, 1)
    assert.equal(broken[0].kind, 'thintext')
    assert.deepEqual(broken[0].measure, { size: 12, weight: 400 })
    await page.locator('#small').evaluate(el => { el.style.fontWeight = '500' })
    assert.deepEqual(await page.evaluate(scan), [])
  } finally { await browser.close() }
})
