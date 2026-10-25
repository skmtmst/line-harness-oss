import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { scanLayoutOverflow } from './layout-overflow.mjs'

for (const width of [1024,1152,1440,1920]) test(`overflow, right edge and missing full text fail at ${width}; restoration is clean`, async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({viewport:{width,height:900}})
    const markup = '<style>body{margin:0}main{width:80vw}</style><main><div id="text">本文</div></main>'
    await page.setContent(markup)
    const normal = await page.evaluate(scanLayoutOverflow)
    assert.deepEqual(normal,{pageX:false,overflow:[],outOfMain:[],noTitle:[],accountName:[],narrowColumn:[],cutAlert:[]})
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
    await page.setContent('<style>body{margin:0}main{width:80vw}</style><header><span data-part="account-name" style="display:inline-block;max-width:128px;width:128px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="長い名前">長い名前</span></header><main></main>')
    assert.ok((await page.evaluate(scanLayoutOverflow)).accountName.length)
    await page.locator('[data-part="account-name"]').evaluate(el=>{el.style.maxWidth='260px'})
    assert.equal((await page.evaluate(scanLayoutOverflow)).accountName.length,0)
    await page.setContent(markup)
    assert.deepEqual(await page.evaluate(scanLayoutOverflow),normal)
  } finally { await browser.close() }
})

test('a table column narrower than 24px fails; a minimum width restores it', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({viewport:{width:834,height:900}})
    const table = cols => `<style>body{margin:0}main{width:600px}.row{display:grid;grid-template-columns:${cols}}</style><main><div role="table"><div role="row" class="row"><span role="columnheader">アカウント</span><span role="columnheader">件数</span></div><div role="row" class="row"><span role="cell" id="name">長いアカウントの名前</span><span role="cell">3 件</span></div></div></main>`
    await page.setContent(table('minmax(0,1fr) 595px'))
    const broken = await page.evaluate(scanLayoutOverflow)
    assert.ok(broken.narrowColumn.length >= 2, JSON.stringify(broken.narrowColumn))
    await page.setContent(table('minmax(160px,1fr) 300px'))
    assert.deepEqual((await page.evaluate(scanLayoutOverflow)).narrowColumn, [])
    // 中身が 1 行で収まる細い数の列は数えない。
    await page.setContent('<style>body{margin:0}main{width:600px}</style><main><div role="row" style="display:grid;grid-template-columns:1fr max-content"><span role="cell">タブレット</span><span role="cell">55</span></div></main>')
    assert.deepEqual((await page.evaluate(scanLayoutOverflow)).narrowColumn, [])
    // 文字の無い列（選ぶ欄・印）は数えない。
    await page.setContent('<style>body{margin:0}main{width:600px}</style><main><div role="row" style="display:grid;grid-template-columns:16px 1fr"><span role="cell"><input type="checkbox"></span><span role="cell">名前</span></div></main>')
    assert.deepEqual((await page.evaluate(scanLayoutOverflow)).narrowColumn, [])
  } finally { await browser.close() }
})

test('a cut warning or failure text fails even with a title; wrapping restores it; short button labels stay allowed', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({viewport:{width:1024,height:900}})
    const cut = 'width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis'
    for (const wrapper of ['<div role="alert">', '<div data-design-part="notice" data-tone="warn">', '<div data-design-part="notice" data-tone="danger" role="note">']) {
      await page.setContent(`<style>body{margin:0}</style><main>${wrapper}<span id="msg" style="display:block;${cut}" title="全文">LINE のトークンの期限が切れています（ほか 1 件）</span></div></main>`)
      assert.ok((await page.evaluate(scanLayoutOverflow)).cutAlert.length, wrapper)
      await page.locator('#msg').evaluate(el => { el.style.whiteSpace = 'normal' })
      assert.deepEqual((await page.evaluate(scanLayoutOverflow)).cutAlert, [], wrapper + 'の修復')
    }
    await page.setContent('<style>body{margin:0}</style><main><div role="alert"><span id="msg" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;width:120px">LINE のトークンの期限が切れています。自動の更新が止まっていないか確かめてください。</span></div></main>')
    assert.ok((await page.evaluate(scanLayoutOverflow)).cutAlert.length, '行数の制限')
    // 案内（info）の知らせと、警告の中のボタンの短い文字は数えない。
    await page.setContent(`<style>body{margin:0}</style><main><div data-design-part="notice" data-tone="info"><span style="display:block;${cut}" title="全文">長い案内の文はここで省略してよい決まりのままです</span></div><div role="alert"><button title="全文" style="${cut}">とても長いボタンの名前のボタン</button></div></main>`)
    assert.deepEqual((await page.evaluate(scanLayoutOverflow)).cutAlert, [])
  } finally { await browser.close() }
})
