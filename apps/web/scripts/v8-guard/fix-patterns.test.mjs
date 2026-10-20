import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scanFixPatterns from './fix-patterns-browser.mjs'
import scanListOperations from './list-operation-browser.mjs'
import { sharedControlOwners } from './fix-pattern-owners.mjs'
import { readFileSync } from 'node:fs'

test('Y14 detects static trailing text overlapping a filter and accepts separate rows and owned controls', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<style>section{width:1200px}#tools{position:relative;height:80px}button{position:absolute;left:0;top:0;width:80px;height:36px}#end{position:absolute;left:70px;top:6px;white-space:nowrap}</style><section data-page-template="list" data-list-skeleton><div id="tools" data-template-region="toolbar"><button>縦長</button><div id="end" data-toolbar-trailing><span>並び：作成が新しい順</span></div></div></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F6, 1)
    await page.locator('#end').evaluate(el => { el.style.left = '88px' })
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F6, 0)
    await page.locator('#end').evaluate(el => { el.style.left = '70px'; el.style.top = '42px' })
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F6, 0, 'another row does not overlap')
    await page.locator('#end').evaluate(el => { el.style.left = '200px'; el.style.top = '0'; el.innerHTML = '<button>並び：作成が新しい順</button>' })
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F6, 0, 'text inside its own button is not a separate tool')
  } finally { await browser.close() }
})

test('X8 detects open explanation controls without a matching body in their page scope', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-page-template="list" data-list-skeleton><header data-template-region="heading"><button data-screen-explanation-toggle aria-controls="body" aria-expanded="true">この画面の説明</button></header></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 1)
    await page.locator('button').evaluate(el => el.setAttribute('aria-expanded', 'false'))
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 0, 'closed unmounted explanation is allowed')
    await page.locator('button').evaluate(el => el.setAttribute('aria-expanded', 'true'))
    await page.locator('section').evaluate(el => el.insertAdjacentHTML('beforeend', '<div data-screen-explanation id="body">元の説明</div>'))
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 0)
    await page.locator('[data-screen-explanation]').evaluate(el => el.outerHTML = '<section data-page-template="detail"><header data-template-region="heading"><button data-screen-explanation-toggle aria-controls="body" aria-expanded="true">この画面の説明</button></header><div data-screen-explanation id="body">別の型の説明</div></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 1, 'another template body cannot satisfy the outer control')
  } finally { await browser.close() }
})

test('X7 detects missing explanation controls even for closed bodies and keeps nested scopes separate', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-page-template="settings"><header data-template-region="heading"><h2>設定</h2></header><div id="explanation" data-screen-explanation>説明本文</div></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 1)
    await page.locator('[data-screen-explanation]').evaluate(el => { el.hidden = true })
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 1, 'closed retained body still requires its control')
    await page.locator('header').evaluate(el => el.insertAdjacentHTML('beforeend', '<button data-screen-explanation-toggle aria-controls="explanation" aria-expanded="false">この画面の説明</button>'))
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 0)
    await page.locator('section').evaluate(el => el.insertAdjacentHTML('beforeend', '<section data-page-template="detail"><header data-template-region="heading"><h2>詳細</h2></header><div id="nested-explanation" data-screen-explanation>別の説明</div></section>'))
    const nested = await page.evaluate(scanFixPatterns)
    assert.equal(nested.counts.F4, 1, 'nested missing control is counted once in its own scope')
    assert.equal(nested.inventory[0].explanationBodies, 1)
    assert.equal(nested.inventory[1].explanationBodies, 1)
    await page.locator('[data-page-template="detail"] header').evaluate(el => el.insertAdjacentHTML('beforeend', '<button data-screen-explanation-toggle aria-controls="nested-explanation">この画面の説明</button>'))
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 0)
    await page.setContent('<section data-page-template="detail"><header data-template-region="heading"><h2>説明のない詳細</h2></header></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F4, 0)
  } finally { await browser.close() }
})

test('F1 reads painted labels without counting an enlarged radio hit target as clipped text', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<style>label{position:relative;display:flex;width:max-content;height:20px;font:13px/20px sans-serif}label::before{content:"";position:absolute;inset:-3px}span{white-space:nowrap}</style><section data-page-template="create"><label><span>リッチメッセージ</span></label></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F1, 0)
    await page.addStyleTag({ content: 'label{width:40px;overflow:hidden}' })
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F1 > 0)
    await page.addStyleTag({ content: 'label{width:max-content;height:8px;overflow:hidden}' })
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F1 > 0)
  } finally { await browser.close() }
})

test('F2 distinguishes a column of upload instructions from a wrapped short action label', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<style>button{display:flex;flex-direction:column;width:240px;font:13px/20px sans-serif}span{display:block}</style><section data-page-template="create"><button><span>画像を追加</span><span>ドラッグ＆ドロップ<br>またはクリック</span><span>PNG・JPEG・10MBまで</span></button></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F2, 0)
    await page.addStyleTag({ content: 'button{width:45px}' })
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F2 > 0)
    await page.setContent('<section data-page-template="create"><button style="width:40px;font:13px/20px sans-serif">変更を保存する</button></section>')
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F2 > 0)
  } finally { await browser.close() }
})

test('F2 measures the name and type inside a horizontal control separately and still catches a wrapping name', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<style>button{display:flex;width:240px;font:13px/20px sans-serif}.labels{display:flex;flex-direction:column;min-width:0}span{display:block}</style><section data-page-template="create"><button><svg width="16" height="16"></svg><div class="labels"><span>来店アンケート</span><span>飾り・見出し1</span></div></button></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F2, 0)
    await page.addStyleTag({ content: 'button{width:45px}' })
    const broken = await page.evaluate(scanFixPatterns)
    assert.ok(broken.counts.F2 > 0)
    assert.ok(broken.findings.some(f => f.pattern === 'F2' && f.text === '来店アンケート'))
    await page.addStyleTag({ content: 'button{width:240px}' })
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F2, 0)
  } finally { await browser.close() }
})

test('F1 catches a selected label ellipsized by half a pixel and accepts its exact rendered width', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-page-template="list" data-list-skeleton="templates"><span data-select-value style="display:inline-block;font:13px Arial;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">フォルダ：すべて</span><span data-list-name style="display:inline-block;width:40px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">省略してよい名前</span></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F1, 0)
    const fullWidth = await page.locator('[data-select-value]').evaluate(el => el.getBoundingClientRect().width)
    await page.locator('[data-select-value]').evaluate((el, width) => el.style.width = `${width - .5}px`, fullWidth)
    const deficit = await page.locator('[data-select-value]').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el)
      return range.getBoundingClientRect().width - el.getBoundingClientRect().width
    })
    assert.ok(deficit > 0 && deficit < 1, 'the regression is smaller than the former one-pixel tolerance')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F1, 1)
    await page.locator('[data-select-value]').evaluate((el, width) => el.style.width = `${width}px`, fullWidth)
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F1, 0)
  } finally { await browser.close() }
})

test('F1 counts clipped numeric notes independently from truncatable names and body', async () => {
  const browser=await connectGuardBrowser()
  try {
    const page=await browser.newPage()
    await page.setContent('<style>td{width:40px}span{display:block;width:40px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><section data-page-template="list" data-list-skeleton="templates"><table><tbody><tr><td data-list-number><span>1,900</span><span>対象外 12 回</span></td></tr></tbody></table></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F1,1)
    await page.addStyleTag({content:'td,span{width:140px}'})
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F1,0)
  } finally {await browser.close()}
})

test('F2 measures each short title in a compound choice and catches wrapped children', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>button{display:flex;align-items:center;width:260px}.text{display:flex;flex-direction:column}span{font:14px/20px Arial}</style>
      <main data-page-template="create"><button><svg width="16" height="16"></svg><span class="text"><span>Question title</span><span>Input kind</span></span></button></main>`)
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F2, 0)
    await page.locator('.text > span').first().evaluate(el => { el.style.width = '35px' })
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F2 > 0)
    await page.locator('.text > span').first().evaluate(el => { el.style.width = '' })
    await page.locator('.text > span').last().evaluate(el => { el.style.width = '20px' })
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F2 > 0)
    await page.setContent(`<style>button{display:flex;width:260px}.text{display:flex;flex-direction:column}span{font:14px/20px Arial}</style>
      <main data-page-template="create"><button><svg width="16" height="16"></svg><span class="text"><span>File title</span><span>First instruction<br>Second instruction</span></span></button></main>`)
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F2, 0)
    await page.locator('.text > span').first().evaluate(el => { el.style.width = '25px' })
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F2 > 0, '題は改行付きの説明と一緒でも数える')
    await page.setContent('<main data-page-template="create"><button style="display:flex;flex-direction:column;width:35px">Question title</button></main>')
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F2 > 0)
    await page.setContent('<main data-page-template="create"><button>Question<br>title</button></main>')
    assert.ok((await page.evaluate(scanFixPatterns)).counts.F2 > 0)
  } finally { await browser.close() }
})

test('list semantics catches two folder/create entries even when they fit, while a distinct creation action stays available', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-page-template="list"><div data-template-region="toolbar"><button aria-label="フォルダ">フォルダ：すべて</button><button aria-label="フォルダで絞り込む">フォルダ：すべて</button><a href="/new">案内を作る</a><a href="/new">案内を作る</a><a href="/folder-new">フォルダを作る</a></div></section>')
    const broken = await page.evaluate(scanListOperations)
    assert.equal(broken.findings.length,2)
    await page.getByRole('button',{name:'フォルダで絞り込む',exact:true}).evaluate(el=>el.remove())
    await page.locator('a[href="/new"]').last().evaluate(el=>el.remove())
    assert.equal((await page.evaluate(scanListOperations)).findings.length,0)
    assert.equal(await page.locator('a').count(),2)
  } finally { await browser.close() }
})

test('read-only list selection is detected, while editable and row-ineligible selections are retained', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-page-template="list"><div data-read-only-notice>閲覧のみ</div><table><thead><tr><th><input type="checkbox" aria-label="全部選ぶ"></th></tr></thead><tbody><tr><td><input type="checkbox" disabled title="この行は対象外" aria-label="行を選ぶ"></td></tr></tbody></table></section>')
    assert.equal((await page.evaluate(scanListOperations)).findings.length,2)
    await page.locator('[data-read-only-notice]').evaluate(el=>el.remove())
    assert.equal((await page.evaluate(scanListOperations)).findings.length,0)
    await page.locator('section').evaluate(el=>{ const notice=document.createElement('div');notice.dataset.readOnlyNotice='';notice.textContent='閲覧のみ';el.prepend(notice) })
    await page.locator('input').evaluateAll(els=>els.forEach(el=>el.remove()))
    assert.equal((await page.evaluate(scanListOperations)).findings.length,0)
  } finally { await browser.close() }
})
