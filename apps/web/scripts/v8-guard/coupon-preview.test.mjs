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

test('coupon fields keep the shared gap and short numeric width; spacing and width faults fail', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-design-part="card"><h2 id="coupon-basics">基本設定</h2><div data-form-row="media-fields" style="display:grid;grid-template-columns:180px 1fr;gap:12px;width:700px"><div data-media-slot style="height:100px"></div><input id="te-coupon-title"></div></section><section data-design-part="card"><h2 id="coupon-benefit">特典</h2><div data-form-row="compact" style="display:flex;gap:12px;width:700px"><div style="width:176px">種類</div><div style="width:176px">表示</div></div><span data-short style="display:block;width:128px"><input type="number" id="benefit" style="width:100%"></span></section>')
    assert.deepEqual(await page.evaluate(scan), [])
    for (const [selector, property, fault, restored, kind] of [
      ['[data-form-row="media-fields"]', 'gridTemplateColumns', '1fr 1fr', '180px 1fr', 'coupon-media-gap'],
      ['[data-form-row="compact"]', 'justifyContent', 'space-between', '', 'coupon-compact-gap'],
      ['[data-short]', 'width', '400px', '128px', 'coupon-number-wide'],
    ]) {
      await page.locator(selector).evaluate((element, patch) => { element.style[patch.property] = patch.value }, { property, value: fault })
      assert.ok((await page.evaluate(scan)).some(finding => finding.kind === kind))
      await page.locator(selector).evaluate((element, patch) => { element.style[patch.property] = patch.value }, { property, value: restored })
      assert.deepEqual(await page.evaluate(scan), [])
    }
  } finally { await browser.close() }
})


test('a shared numeric error stays below its compact row; moving it into a column fails',async()=>{
 const browser=await connectGuardBrowser()
 try{
  const page=await browser.newPage()
  await page.setContent('<section data-design-part="card"><h2 id="coupon-basics">基本設定</h2></section><section data-design-part="card"><h2 id="coupon-benefit">特典</h2><div data-form-row="compact" style="display:flex;gap:12px"><div id="first"><span data-short style="display:block;width:128px"><input type="number" style="width:100%"></span></div><div><span data-short style="display:block;width:128px"><input type="number" style="width:100%"></span></div></div><p role="alert" style="width:400px">割引後の金額を確認してください</p></section>')
  assert.deepEqual(await page.evaluate(scan),[])
  await page.evaluate(()=>document.querySelector('#first').append(document.querySelector('[role="alert"]')))
  assert.ok((await page.evaluate(scan)).some(f=>f.kind==='coupon-compact-gap'))
  await page.evaluate(()=>document.querySelector('[data-form-row]').after(document.querySelector('[role="alert"]')))
  assert.deepEqual(await page.evaluate(scan),[])
 }finally{await browser.close()}
})

test('coupon action entry uses the shared border and starts at the heading edge',async()=>{
 const browser=await connectGuardBrowser()
 try{
  const page=await browser.newPage()
  await page.setContent('<section data-design-part="card" style="padding:24px"><h2 id="coupon-use-actions">使用時の処理</h2><button data-shared-button data-variant="secondary">行うことを足す</button></section>')
  assert.deepEqual(await page.evaluate(scan),[])
  await page.locator('button').evaluate(e=>{e.style.marginLeft='19px'})
  assert.ok((await page.evaluate(scan)).some(f=>f.kind==='coupon-action-start'))
  await page.locator('button').evaluate(e=>{e.style.marginLeft='';e.setAttribute('data-variant','text')})
  assert.ok((await page.evaluate(scan)).some(f=>f.kind==='coupon-action-start'))
  await page.locator('button').evaluate(e=>{e.setAttribute('data-variant','secondary')})
  assert.deepEqual(await page.evaluate(scan),[])
 }finally{await browser.close()}
})
