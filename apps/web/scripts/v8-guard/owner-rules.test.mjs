import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import scan from './owner-rules-browser.mjs'
import { assess, record, measurePage } from './layout-defects.mjs'

const shell = body => `<style>*{box-sizing:border-box}body{margin:0;font:16px/20px sans-serif}main{width:1000px}button{font:inherit}p{margin:0}</style><main>${body}</main>`
const row = (body,style='') => `<div role="row" style="display:flex;align-items:center;width:600px;height:56px;padding:0 24px;${style}">${body}</div>`
const table = body => `<div role="table" data-shared-part="list-table" style="width:600px">${body}</div>`
const cases = {
  align: table([0,20,0].map(x=>row(`<button data-row-menu style="margin-left:${x}px">…</button>`)).join('')),
  missing: table([true,false,true].map(show=>row(`<b>名前</b>${show?'<button data-row-menu>…</button>':''}`)).join('')),
  short: '<span title="とても長い名前" style="display:block;width:32px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">名前…</span>',
  tallrow: table(row('<span>名前</span>','height:100px')),
  blue: '<a style="color:#2563eb">文字のリンク</a>',
  tight: '<section style="border:1px solid;width:200px;height:100px"><span>端に付く中身</span></section>',
  rowbg: table('<div style="padding:0 24px">'+row('<span>赤い行</span>','background:#fee2e2;width:552px')+'</div>'),
  dark: '<div style="background:#1d1d1f;color:white;width:200px;height:36px">黒い札</div>',
  boxclip: '<div style="overflow:hidden;height:100px"><section style="margin-top:70px;border:1px solid;width:200px;height:80px;padding:16px">切れた箱</section></div>',
  footgap: '<p>本文</p><div data-shared-part="sticky-bar" style="margin-top:120px;height:56px">保存</div>',
  edge: table(row('<span style="margin-left:auto">…</span>','padding-right:4px')),
  inset: '<div><div data-list-toolbar style="margin:0 24px;width:552px;height:36px">道具</div>'+table(row('<span>名前</span>'))+'</div>',
  greenname: table(row('<b data-list-name style="color:#087a3e">名前</b>')),
  shortname: table(row('<b data-list-name>短い名前…</b>')),
}
const repairs = {
  align: cases.align.replaceAll('margin-left:20px','margin-left:0px'),
  missing: table([1,2,3].map(()=>row('<b>名前</b><button data-row-menu>…</button>')).join('')),
  short: cases.short.replace('width:32px','width:200px').replace('名前…','表示できる長い名前'),
  tallrow: cases.tallrow.replace('height:100px','height:56px'),
  blue: cases.blue.replace('#2563eb','#087a3e'),
  tight: cases.tight.replace('height:100px','height:100px;padding:16px'),
  rowbg: table(row('<span>赤い行</span>','background:#fee2e2')),
  dark: cases.dark.replace('#1d1d1f','white').replace('color:white','color:#1d1d1f'),
  boxclip: cases.boxclip.replace('height:100px','height:180px'),
  footgap: cases.footgap.replace('margin-top:120px','margin-top:16px'),
  edge: cases.edge.replace('padding-right:4px','padding-right:24px'),
  inset: cases.inset.replace('margin:0 24px;width:552px','margin:0;width:600px;padding:0 24px'),
  greenname: cases.greenname.replace('#087a3e','#1d1d1f'),
  shortname: cases.shortname.replace('短い名前…','十二字以上を見せる長い名前の省略…'),
}

test('14種類を実寸で故障注入し、修正すれば検出0（ブラウザ1つ）', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({viewport:{width:1152,height:900}})
    for (const [kind,html] of Object.entries(cases)) {
      await page.setContent(shell(html))
      assert.ok((await page.evaluate(scan)).some(f=>f.kind===kind),`故障を見逃した: ${kind}`)
      await page.setContent(shell(repairs[kind]))
      assert.deepEqual(await page.evaluate(scan),[],`修正後: ${kind}`)
    }
    await page.setContent(shell('<p>本文</p>') + '<div role="tooltip" style="background:#111;color:white;width:200px;height:36px">黒いふきだし</div>')
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='dark'),'mainの外の吹き出しも見逃さない')
    await page.setContent(shell('<span style="display:block;width:32px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">元の全文は長い名前なのに二文字しか見えない</span>'))
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='short'),'全文がDOMに残る実装の省略も測る')
    await page.setContent(shell('<div role="grid"><div role="row" style="display:flex;height:100px"><div role="gridcell" style="border:1px solid;width:140px;height:100px">1日</div></div></div>'))
    assert.equal((await page.evaluate(scan)).some(f=>['tight','tallrow','edge'].includes(f.kind)),false,'カレンダーの週は一覧の行ではない')
    await page.setContent(shell(row('<span>移行の履歴</span><b style="color:#087a3e;background:#e8f5ec">反映ずみ</b>')))
    assert.equal((await page.evaluate(scan)).some(f=>f.kind==='greenname'),false,'色付きの状態は名前ではない')
    // 正規のスクロール欄は送って見る。hidden に戻すと箱の切れを拾う。
    await page.setContent(shell(cases.boxclip.replace('overflow:hidden','overflow:auto')))
    assert.equal((await page.evaluate(scan)).some(f=>f.kind==='boxclip'),false)
    await page.setContent(shell('<video data-video-player style="background:#111;width:300px;height:160px">動画</video>'))
    assert.equal((await page.evaluate(scan)).some(f=>f.kind==='dark'),false)
    await page.setContent(shell(row('<span style="color:#087a3e">12 件</span><b>黒い名前</b>')))
    assert.equal((await page.evaluate(scan)).some(f=>f.kind==='greenname'),false,'件数リンクは緑のまま')
  } finally { await browser.close() }
})
test('新規の故障をCLIが非0で止める。理由なしの除外は使えない', () => {
  const dir=mkdtempSync(join(tmpdir(),'pendec-guard-'))
  try {
    const file=join(dir,'cases.json')
    writeFileSync(file,JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k,v])=>[k,shell(v)]))))
    const broken=spawnSync(process.execPath,['apps/web/scripts/v8-guard/layout-defects.mjs','--fixtures',file],{encoding:'utf8',timeout:60000})
    assert.equal(broken.status,1,broken.stdout+broken.stderr)
    for (const kind of Object.keys(cases)) assert.match(broken.stdout,new RegExp('  '+kind+' '))
  } finally { rmSync(dir,{recursive:true,force:true}) }
  const f={kind:'edge',target:'tr',text:'',measure:{deficit:8}}
  const allowances=record([f],'/friends',1152,'固定Penと照合済みの既存箇所')
  assert.equal(assess([{...f,measure:{deficit:9}}],'/friends',1152,allowances).failures.length,1)
  assert.throws(()=>assess([f],'/friends',1152,[{...allowances[0],reason:''}]))
})

test('一覧の判定を足しても、既存GridTableの幅による畳み方を失わない', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const css = readFileSync(new URL('../../src/components/shared/data-table.module.css', import.meta.url), 'utf8')
    await page.setContent(shell(`<style>${css}[data-grid-probe]{color:rgb(9,9,9)}@container shared-grid-table (max-width:800px){[data-grid-probe]{color:rgb(1,2,3)}}</style><div class="frame" data-shared-part="list-table" data-grid-table style="width:500px"><span data-grid-probe>補助列</span></div>`))
    await page.evaluate(() => { document.documentElement.dataset.theme = 'v8' })
    assert.equal(await page.locator('[data-grid-probe]').evaluate(el => getComputedStyle(el).color), 'rgb(1, 2, 3)')
    await page.locator('.frame').evaluate(el => { el.style.width = '900px' })
    assert.equal(await page.locator('[data-grid-probe]').evaluate(el => getComputedStyle(el).color), 'rgb(9, 9, 9)')
  } finally { await browser.close() }
})


test('共通の余白が実際に16pxになり、カレンダーを一覧の器に変えない', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8')
    await page.setContent(shell(`<style>${read('app/globals.css')}${read('components/shared/card.module.css')}${read('components/shared/data-table.module.css')}</style><section class="card vertical" data-card-padding="none" data-card-variant="default"><p>見出し</p><p>本文</p></section><div class="frame" data-table-presentation="calendar"><span>時刻と卓の格子</span></div>`))
    await page.evaluate(() => { document.documentElement.dataset.theme = 'v8' })
    assert.deepEqual(await page.locator('section').evaluate(el => ({ padding: getComputedStyle(el).paddingTop, gap: getComputedStyle(el).rowGap })), { padding: '16px', gap: '16px' })
    assert.equal(await page.locator('[data-table-presentation="calendar"]').evaluate(el => getComputedStyle(el).containerType), 'normal')
  } finally { await browser.close() }
})


test('選ぶ箱の短い題は1行、状態の隣の短いマークは切れない', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8')
    await page.setContent(shell(`<style>${read('app/globals.css')}${read('components/shared/radio-card.module.css')}${read('components/shared/status-pill.module.css')}</style><strong class="title" style="display:block;width:110px" title="報酬なし（計測のみ）">報酬なし（計測のみ）</strong><div style="display:flex;width:90px;gap:8px;font:11px/18px sans-serif"><span class="pill" style="width:52px">状態</span><span title="対応マーク：担当中" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">担当中</span></div>`))
    await page.evaluate(() => { document.documentElement.dataset.theme = 'v8' })
    assert.equal(await page.locator('strong').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap')
    assert.equal((await page.evaluate(scan)).filter(f => f.kind === 'short' && f.text === '担当中').length, 0)
  } finally { await browser.close() }
})


test('閉じた設定は描画扱いにせず、開いたら重なり・黒い面を検出する', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(shell('<details><summary>設定</summary><div style="position:relative;background:#222;color:white;width:200px;height:80px"><span style="display:block">中の文字その一</span><span style="display:block;margin-top:-20px">中の文字その二</span></div></details>'))
    assert.equal((await measurePage(page)).filter(f => /中の文字/.test(f.text)).length, 0)
    await page.locator('summary').click()
    const opened = await measurePage(page)
    assert.ok(opened.some(f => f.kind === 'overlap' && /中の文字/.test(f.text)), JSON.stringify(opened))
    assert.ok(opened.some(f => f.kind === 'dark' && /中の文字/.test(f.text)), JSON.stringify(opened))
  } finally { await browser.close() }
})

test('編集用の吹き出しをLINEの見本と取り違えず、本当の重なりを検出する', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const bubble = '<div class="bubble" style="position:relative;width:300px;height:150px"><span style="display:block">編集の文字その一</span><span style="display:block;margin-top:-20px">編集の文字その二</span><textarea style="position:absolute;left:0;top:30px;width:300px;height:100px" aria-label="本文"></textarea></div>'
    await page.setContent(shell(`<section data-message-composer>${bubble}</section>`))
    const findings = await measurePage(page)
    assert.ok(findings.some(f => f.kind === 'overlap' && /編集の文字/.test(f.text)), JSON.stringify(findings))
    assert.equal(findings.filter(f => f.kind.startsWith('blank-')).length, 0)
    await page.setContent(shell(`<section data-line-preview-part="talk">${bubble}</section>`))
    assert.equal((await measurePage(page)).filter(f => /編集の文字/.test(f.text)).length, 0)
  } finally { await browser.close() }
})
