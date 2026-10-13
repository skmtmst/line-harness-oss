import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import scanFixPatterns from './fix-patterns-browser.mjs'
import { sharedControlOwners } from './fix-pattern-owners.mjs'

test('Y14 detects static trailing text overlapping a filter and accepts separate rows and owned controls', async () => {
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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

test('X1/X2 use folder capability across widths; X3 checks all heading types', async () => {
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage()
    await page.setContent(`<section data-page-template="list" data-list-skeleton="templates"><header data-template-region="heading"><h2>一覧</h2><button>この画面の説明</button><button aria-label="一覧の説明">？</button><div data-heading-actions></div></header><div data-list-folders="false"><div data-template-region="toolbar"><a href="/new">決めごとを作る</a></div><span data-list-name><span data-folder-dot>○</span>名前</span></div></section>`)
    const before=await page.evaluate(scanFixPatterns)
    assert.equal(before.counts.F9,2)
    assert.equal(before.counts.F3,1)
    await page.evaluate(() => {
      const heading=document.querySelector('header')
      heading.querySelector('[data-heading-actions]').append(document.querySelector('a'))
      document.querySelector('[data-folder-dot]').remove()
      const help=heading.querySelector('[aria-label]');heading.insertBefore(help,heading.querySelector('button'))
    })
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F9,0)
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F3,0)
    await page.evaluate(() => {
      document.querySelector('[data-list-folders]').dataset.listFolders='true'
      document.querySelector('[data-template-region="toolbar"]').append(document.querySelector('a'))
      document.querySelector('[data-list-name]').insertAdjacentHTML('afterbegin','<span data-folder-dot>○</span>')
    })
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F9,0, 'collapsed folder-capable lists retain tools and dots')
    await page.evaluate(() => {
      document.querySelector('section').dataset.pageTemplate='create'
      const heading=document.querySelector('header');heading.append(heading.querySelector('[aria-label]'))
    })
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F3,1,'all templates check help order')
  } finally {await browser.close()}
})

test('F1 reads painted labels without counting an enlarged radio hit target as clipped text', async () => {
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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

test('F9 detects a left aligned action slot and accepts shared right alignment', async () => {
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage()
    await page.setContent('<style>td{width:180px;padding:8px;text-align:left}button{width:36px}</style><section data-page-template="list" data-list-skeleton="templates"><table><tbody><tr><td data-list-action-cell><button>…</button></td></tr></tbody></table></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F9,1)
    await page.addStyleTag({content:'td{text-align:right}'})
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F9,0)
  } finally {await browser.close()}
})

test('F1 counts clipped numeric notes independently from truncatable names and body', async () => {
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage()
    await page.setContent('<style>td{width:40px}span{display:block;width:40px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><section data-page-template="list" data-list-skeleton="templates"><table><tbody><tr><td data-list-number><span>1,900</span><span>対象外 12 回</span></td></tr></tbody></table></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F1,1)
    await page.addStyleTag({content:'td,span{width:140px}'})
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F1,0)
  } finally {await browser.close()}
})

test('F7 counts unknown annotations in a cell and KPI note while retaining known values', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-page-template="list" data-list-skeleton="templates"><table><tbody><tr><td>—（未取得）</td><td>0</td><td>未設定</td><td>なし</td></tr></tbody></table><div data-kpi-detail><span role="note">今日 —（未取得）</span></div></section>')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F7,2)
    await page.locator('td').first().evaluate(el=>el.textContent='—')
    await page.locator('[role="note"]').evaluate(el=>el.textContent='今日 —')
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F7,0)
    assert.equal(await page.locator('td').nth(1).innerText(),'0')
  } finally { await browser.close() }
})

test('F5 checks rendered toolbar control ownership without board exceptions', async () => {
  const owners = sharedControlOwners()
  assert.ok(owners.includes('button'))
  assert.ok(owners.includes('v6-filter-chip'))
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-page-template="list" data-list-skeleton="templates"><div data-template-region="toolbar"><button class="button_button__abc">作成する</button><button class="v6-filter-chip">公開中</button><button class="page_ghostButton__abc">保存する</button></div></section>')
    const before = await page.evaluate(scanFixPatterns, {cssOwners:owners})
    assert.equal(before.counts.F5, 1)
    assert.equal(before.findings.find(f=>f.pattern==='F5').text, '保存する')
    await page.locator('.page_ghostButton__abc').evaluate(el=>el.className='button_text__abc')
    assert.equal((await page.evaluate(scanFixPatterns,{cssOwners:owners})).counts.F5,0)
    await page.locator('[data-page-template]').evaluate(el=>el.insertAdjacentHTML('beforeend','<button data-row-menu class="row-actions_action__abc page_menu__abc">…</button>'))
    assert.equal((await page.evaluate(scanFixPatterns,{cssOwners:owners})).counts.F5,1)
    await page.locator('[data-row-menu]').evaluate(el=>el.classList.remove('page_menu__abc'))
    assert.equal((await page.evaluate(scanFixPatterns,{cssOwners:owners})).counts.F5,0)
  } finally { await browser.close() }
})

test('F1/F2/F3/F7/F9/F10 count defects, preserve presence and ignore truncated names', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}section{width:852px}button{height:36px}th{white-space:nowrap}table{width:100%}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}</style><section data-page-template="list" data-design-node="fixture" data-height-mode="content">
      <header data-template-region="heading"><h2>一覧</h2><button aria-label="一覧の説明">?</button></header>
      <div data-template-region="toolbar" style="display:flex;gap:8px"><button><span data-select-value style="display:block;white-space:nowrap;width:40px;overflow:hidden">フォルダ：すべての情報</span></button><input type="search" style="width:70px" placeholder="名前・本文から探す"><span data-list-sort><button>↓</button></span></div>
      <table><thead><tr><th style="font:18px/24px sans-serif">状態<span style="font:10px/12px sans-serif;vertical-align:middle">?</span></th><th><span class="sr-only">操作</span></th></tr></thead><tbody><tr><td data-list-name-cell><span data-list-name style="display:block;width:50px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">省略してよい長い名前</span></td><td><span data-list-date-time style="display:block;width:55px">09/30 14:12</span></td><td><span data-unknown-value>種類を確認できません</span></td><td><button>直す</button></td></tr></tbody></table>
      <aside data-template-region="folders">フォルダ</aside><div data-kpi-strip><button data-row-menu>…</button></div></section>`)
    const before = await page.evaluate(scanFixPatterns)
    for (const pattern of ['F1','F2','F3','F4','F7','F8','F9','F10']) assert.ok(before.counts[pattern] > 0, pattern)
    assert.equal(before.inventory[0].help[0], '一覧の説明')
    assert.ok(!before.findings.some(f => ['F1','F2'].includes(f.pattern) && f.text.includes('省略してよい')))
    await page.evaluate(() => {
      document.querySelector('[data-page-template]').setAttribute('data-list-skeleton','templates')
      document.querySelector('[data-select-value]').style.width='200px'
      document.querySelector('input').style.width='240px'
      document.querySelector('[data-list-date-time]').style.width='120px'
      document.querySelector('[data-unknown-value]').textContent='—'
      document.querySelector('td button').textContent='編集する'
      document.querySelector('[data-list-sort]').innerHTML='<button><span data-select-value>並び：新しい順</span></button>'
      document.querySelector('aside').hidden=true
      document.querySelector('[data-row-menu]').remove()
    })
    const after = await page.evaluate(scanFixPatterns)
    assert.ok(Object.values(after.counts).every(n => n === 0), JSON.stringify(after.findings))
  } finally { await browser.close() }
})


test('W1 scans linked creation and native selects across the whole template toolbar', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>*{box-sizing:border-box}section{width:900px}a,button,select,input{display:inline-flex;height:36px;padding:0 12px;border:1px solid;align-items:center;font:13px Arial}a{width:max-content}div{display:flex;gap:8px}input{width:280px}</style><section data-page-template="list" data-list-skeleton="templates"><div data-template-region="toolbar" style="display:block"><div data-toolbar-leading><a href="/new">送り先を作る</a><select aria-label="フォルダ"><option>フォルダ：すべて</option></select><input type="search"></div><div><select aria-label="状態"><option>状態：すべて</option></select><button>よく使う絞り込み</button><button>20件表示</button></div></div></section>`)
    assert.equal((await page.evaluate(scanFixPatterns)).counts.F10,0)
    await page.locator('a').evaluate(el=>el.style.width='100%')
    assert.ok((await page.evaluate(scanFixPatterns)).findings.some(f=>f.reason.includes('create action stretches')))
    await page.locator('[data-toolbar-leading]').evaluate(el=>el.style.flexDirection='column')
    const broken = await page.evaluate(scanFixPatterns)
    assert.ok(broken.findings.some(f=>f.reason.includes('tool rows')))
    assert.ok(broken.findings.some(f=>f.reason.includes('isolated select')))
  } finally { await browser.close() }
})


test('W2 and W3 count empty folder rails and spaced page-size wording', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<section data-page-template="list" data-list-skeleton="templates" style="width:1200px"><aside data-template-region="folders"><nav><button>すべて</button></nav></aside><button>20 件表示</button></section>')
    const before=await page.evaluate(scanFixPatterns)
    assert.equal(before.counts.F8,1)
    assert.equal(before.counts.F3,1)
    await page.locator('aside').evaluate(el=>el.remove())
    await page.locator('button').evaluate(el=>el.textContent='20件表示')
    const after=await page.evaluate(scanFixPatterns)
    assert.equal(after.counts.F8,0)
    assert.equal(after.counts.F3,0)
  } finally {await browser.close()}
})


test('W4 distinguishes heading actions and archive filters without board IDs',async()=>{
 const browser=await chromium.launch()
 try{const page=await browser.newPage()
 await page.setContent('<section data-page-template="list" data-list-skeleton style="width:1200px"><header data-template-region="heading"><button class="v6-filter-chip">管理者確認</button></header><button class="v6-filter-chip">アーカイブ済み</button></section>')
 const before=await page.evaluate(scanFixPatterns)
 assert.equal(before.counts.F5,1);assert.equal(before.counts.F4,1)
 await page.locator('header button').evaluate(el=>el.className='button_secondary__x')
 await page.locator('button.v6-filter-chip').evaluate(el=>el.insertAdjacentHTML('afterbegin','<svg width="13" height="13" aria-hidden="true"></svg>'))
 const after=await page.evaluate(scanFixPatterns)
 assert.equal(after.counts.F5,0);assert.equal(after.counts.F4,0)
 }finally{await browser.close()}
})
