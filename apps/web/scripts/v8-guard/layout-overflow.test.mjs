import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { scanLayoutOverflow } from './layout-overflow.mjs'

for (const width of [1152,1440,1920]) test(`overflow, right edge and missing full text fail at ${width}; restoration is clean`, async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({viewport:{width,height:900}})
    const markup = '<style>body{margin:0}main{width:80vw}</style><main><div id="text">本文</div></main>'
    await page.setContent(markup)
    const normal = await page.evaluate(scanLayoutOverflow)
    assert.deepEqual(normal,{pageX:false,overflow:[],outOfMain:[],noTitle:[]})
    await page.locator('#text').evaluate(el=>{el.style.cssText='width:10px;white-space:nowrap;overflow:hidden';el.textContent='はみ出す長い文字列'})
    assert.ok((await page.evaluate(scanLayoutOverflow)).overflow.length)
    await page.locator('#text').evaluate(el=>{el.style.textOverflow='ellipsis'})
    assert.ok((await page.evaluate(scanLayoutOverflow)).noTitle.length)
    await page.locator('#text').evaluate(el=>{el.title=el.textContent})
    assert.equal((await page.evaluate(scanLayoutOverflow)).noTitle.length,0)
    await page.locator('#text').evaluate(el=>{el.style.cssText='width:110vw;height:40px'})
    const broken=await page.evaluate(scanLayoutOverflow)
    assert.ok(broken.pageX)
    assert.ok(broken.outOfMain.length)
    await page.setContent(markup)
    assert.deepEqual(await page.evaluate(scanLayoutOverflow),normal)
  } finally { await browser.close() }
})
