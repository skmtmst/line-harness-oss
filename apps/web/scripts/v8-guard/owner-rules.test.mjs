import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import scan from './owner-rules-browser.mjs'
import { assess, record, measurePage } from './layout-defects.mjs'
import './list-row-height.test.mjs'
import './csv-publication-layout.test.mjs'

const shell = body => `<style>*{box-sizing:border-box}body{margin:0;font:16px/20px sans-serif}main{width:1000px}button{font:inherit}p{margin:0}</style><main>${body}</main>`

test('header edge measures the text inside padded cells and still detects text or controls too near the edge', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const edge = async () => (await page.evaluate(scan)).filter(f => f.kind === 'edge')
    for (const label of ['状態・操作', '<button>操作</button>']) {
      await page.setContent(shell(`<table style="width:600px"><thead><tr><th style="height:40px;padding:0 24px;text-align:right">${label}</th></tr></thead></table>`))
      assert.deepEqual(await edge(), [], 'the cell box reaches the edge but its text/control has 24px of inset')
      await page.locator('th').evaluate(el => el.style.paddingInlineEnd = '4px')
      assert.ok((await edge()).some(f => f.measure.deficit >= 8), 'real 4px inset remains a failure')
      await page.locator('th').evaluate(el => el.style.paddingInlineEnd = '24px')
      assert.deepEqual(await edge(), [])
    }
  } finally { await browser.close() }
})
const row = (body,style='') => `<div role="row" style="display:flex;align-items:center;width:600px;height:56px;padding:0 24px;${style}">${body}</div>`
const table = body => `<div role="table" data-shared-part="list-table" style="width:600px">${body}</div>`
test('同じ面の編集本文は描いた文字の余白を測り、余白0・別枠の端接触は止める', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const content = (padding, ownFrame = '') => shell(`<section style="width:240px;height:120px;background:white;border:1px solid gray"><div contenteditable="true" role="textbox" style="height:100%;padding:${padding}px;background:white;${ownFrame}">編集する本文</div></section>`)
    for (const editable of ['true', 'false']) {
      await page.setContent(content(12).replace('contenteditable="true"', `contenteditable="${editable}"`))
      assert.equal((await page.evaluate(scan)).filter(f => f.kind === 'tight').length, 0)
    }
    await page.setContent(content(0))
    assert.ok((await page.evaluate(scan)).some(f => f.kind === 'tight'))
    await page.setContent(content(12, 'border:1px solid black;'))
    assert.ok((await page.evaluate(scan)).some(f => f.kind === 'tight'))
    await page.setContent(content(12, 'background:#ddd;'))
    assert.ok((await page.evaluate(scan)).some(f => f.kind === 'tight'))
  } finally { await browser.close() }
})
test('本文と差し込みの一つの枠は読み込み順によらず内側の影を外し、外側のフォーカスを保つ', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const bodyCSS = readFileSync(new URL('../../src/components/shared/message-insert-row.module.css', import.meta.url), 'utf8')
    const editorCSS = readFileSync(new URL('../../src/components/shared/insert-text-field.module.css', import.meta.url), 'utf8')
    for (const ordered of [[bodyCSS, editorCSS], [editorCSS, bodyCSS]]) {
      await page.setContent(shell(`<style>:root{--control-shadow:0 1px 2px #aaa;--color-canvas:white;--color-control-border:gray;--color-focus-ring:blue;--tpl-nc-body-pad:10px 12px}${ordered.join('\n')}</style><div class="body" style="height:120px;width:240px"><div class="editor editorCompact" data-insert-field contenteditable="true" style="height:100%;padding:12px">編集する本文</div></div>`))
      assert.equal(await page.locator('[data-insert-field]').evaluate(el => getComputedStyle(el).boxShadow), 'none')
      assert.equal((await page.evaluate(scan)).filter(f => f.kind === 'tight').length, 0)
      await page.locator('[data-insert-field]').focus()
      assert.equal(await page.locator('.body').evaluate(el => getComputedStyle(el).outlineWidth), '2px')
      await page.locator('[data-insert-field]').evaluate(el => { el.style.padding = '0px' })
      assert.ok((await page.evaluate(scan)).some(f => f.kind === 'tight'))
    }
  } finally { await browser.close() }
})
test('B-245：共通の説明ボタンは青で出し、印だけの手書きや頭の外の青は検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const control = (label, classes = 'page-explanation_toggle__test') => `<button type="button" class="${classes}" data-shared-part="page-explanation-toggle" aria-controls="explanation" aria-expanded="false" style="color:#2563eb;background:transparent;border:0">${label}</button>`
    await page.setContent(shell(`<header data-template-region="heading">${control('この画面の説明')}${control('手書きの青', 'screen_blue')}</header>${control('頭の外の青')}<a style="color:#2563eb">普通の青いリンク</a>`))
    const blue = (await page.evaluate(scan)).filter(f => f.kind === 'blue').map(f => f.text)
    assert.deepEqual(blue.sort(), ['手書きの青', '普通の青いリンク', '頭の外の青'].sort())
    await page.locator('.page-explanation_toggle__test').first().evaluate(el => { el.removeAttribute('aria-controls') })
    assert.ok((await page.evaluate(scan)).some(f => f.kind === 'blue' && f.text === 'この画面の説明'), '開閉する共通部品の条件を崩すと検出する')
  } finally { await browser.close() }
})
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
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({viewport:{width:1152,height:900}})
    for (const [kind,html] of Object.entries(cases)) {
      await page.setContent(shell(html))
      assert.ok((await page.evaluate(scan)).some(f=>f.kind===kind),`故障を見逃した: ${kind}`)
      await page.setContent(shell(repairs[kind]))
      assert.deepEqual(await page.evaluate(scan),[],`修正後: ${kind}`)
    }
    // WQmep：正本の共通72pxの指定だけを認める。指定を越える行は見逃さない。
    const inbox = height => `<div data-shared-part="list-table" data-column-layout style="--tpl-db-inbox-row-h:72px;--table-row-height:var(--tpl-db-inbox-row-h)">${row('<span style="line-height:18px">名前</span>',`height:${height}px`)}</div>`
    await page.setContent(shell(inbox(72)))
    assert.equal((await page.evaluate(scan)).some(f=>f.kind==='tallrow'),false)
    await page.setContent(shell(inbox(80)))
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='tallrow'))
    await page.setContent(shell(inbox(72).replace('--table-row-height:var(--tpl-db-inbox-row-h)','--table-row-height:72px')))
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='tallrow'),'画面で直接72にして見張りを外せない')
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
test('操作帯の前の余白は、印付きのボタンや入力の下端から測る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const control of [
      '<a href="#" style="display:block;height:36px">手順を見る<svg width="16" height="16"><path d="M0 0 L16 16" /></svg></a>',
      '<input aria-label="名前" value="入力した内容" style="display:block;height:36px">',
    ]) {
      const probe = gap => shell(`<p>説明</p><div style="margin-top:120px">${control}</div><div data-shared-part="sticky-bar" style="margin-top:${gap}px;height:56px">保存</div>`)
      await page.setContent(probe(16))
      assert.equal((await page.evaluate(scan)).some(f => f.kind === 'footgap'), false)
      await page.setContent(probe(120))
      assert.equal((await page.evaluate(scan)).some(f => f.kind === 'footgap'), true, '実際の120pxの空白は検出する')
    }
    await page.setContent(shell('<p>説明</p><input style="display:none"><div data-shared-part="sticky-bar" style="margin-top:120px;height:56px">保存</div>'))
    assert.equal((await page.evaluate(scan)).some(f => f.kind === 'footgap'), true, '隠れた入力で空白を隠せない')
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

test('共通スマホの外枠・島・上の帯と画像枠は除外し、隣の黒い箱と余白不足は落とす', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({width, height:900})
      const phone = '<div style="background:#111;color:white;width:330px;height:690px"><div style="background:#000;width:96px;height:28px">島</div><div style="background:#222;height:44px">LINEの上の帯</div></div>'
      for (const marker of ['data-line-preview-part="phone"', 'class="line-preview_phoneRoot__oldBase"']) {
        await page.setContent(shell(`<section ${marker}>${phone}</section>${cases.dark}${cases.tight}`))
        const findings = await page.evaluate(scan)
        assert.equal(findings.filter(f => f.kind === 'dark').length, 1, '隣の黒い箱だけを検出')
        assert.equal(findings.filter(f => f.kind === 'tight').length, 1, '隣の通常の箱は検査する')
      }
      for (const marker of ['data-media-slot', 'data-design-node="Z7vd2" data-kind="image" role="group"']) {
        await page.setContent(shell(`<div ${marker} style="border:1px solid;width:200px;height:100px"><span>画像を追加</span></div>${cases.tight}`))
        assert.equal((await page.evaluate(scan)).filter(f => f.kind === 'tight').length, 1)
      }
    }
  } finally { await browser.close() }
})

test('一覧の判定を足しても、既存GridTableの幅による畳み方を失わない', async () => {
  const browser = await connectGuardBrowser()
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
  const browser = await connectGuardBrowser()
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
  const browser = await connectGuardBrowser()
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
  const browser = await connectGuardBrowser()
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
  const browser = await connectGuardBrowser()
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

test('窓の中のスクロールの続きを余白不足と誤判定せず、実際の下端の不足は落とす', async () => {
  const browser=await connectGuardBrowser()
  try {
    const page=await browser.newPage({viewport:{width:1152,height:900}})
    const content='<section style="border:1px solid;width:320px;height:180px;padding:16px;display:flex;flex-direction:column"><h2 style="margin:0">題</h2><div style="min-height:0;flex:1;overflow-y:auto"><p style="height:300px">続きは送って読める内容</p></div><footer>下の操作</footer></section>'
    await page.setContent(shell(content))
    assert.deepEqual((await page.evaluate(scan)).filter(f=>f.kind==='tight'),[])
    await page.locator('section').evaluate(el=>el.style.paddingBottom='0px')
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='tight'))
  } finally { await browser.close() }
})

test('列で組む表も見出しと本文の右端・中央・左余白がそろう', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8')
    await page.setContent(shell(`<style>${read('app/globals.css')}${read('components/shared/table.module.css')}</style>
      <div class="headRow" data-table-layout="columns" role="row" style="width:600px">
        <div class="cell" style="width:230px"><span id="head-name">名前</span></div>
        <div class="cell right" style="width:160px"><span id="head-number">件数</span></div>
        <div class="cell center" style="width:100px"><span id="head-state">状態</span></div>
      </div>
      <div role="row" style="display:flex;align-items:center;gap:16px;width:600px;height:56px;padding:0 24px">
        <div style="width:230px"><span id="body-name">名前</span></div>
        <div style="width:160px;text-align:right"><span id="body-number">件数</span></div>
        <div style="width:100px;text-align:center"><span id="body-state">状態</span></div>
      </div>`))
    await page.evaluate(() => { document.documentElement.dataset.theme = 'v8' })
    const positions = () => page.evaluate(() => {
      const glyph = id => {
        const range = document.createRange()
        range.selectNodeContents(document.getElementById(id))
        const r = range.getBoundingClientRect()
        return { left: r.left, right: r.right, center: (r.left + r.right) / 2, middle: (r.top + r.bottom) / 2 }
      }
      const row = document.querySelector('.headRow').getBoundingClientRect()
      return { name: glyph('head-name'), number: glyph('head-number'), state: glyph('head-state'),
        bodyNumber: glyph('body-number'), bodyState: glyph('body-state'),
        row: { left: row.left, height: row.height, middle: (row.top + row.bottom) / 2 } }
    })
    const good = await positions()
    assert.ok(Math.abs(good.number.right - good.bodyNumber.right) <= 1, '数字の列の右端')
    assert.ok(Math.abs(good.state.center - good.bodyState.center) <= 1, '状態の列の中央')
    assert.equal(good.name.left - good.row.left, 24, '親とセルで端の余白を二重にしない')
    assert.equal(good.row.height, 40)
    assert.ok(Math.abs(good.name.middle - good.row.middle) <= 3, '文字を上下中央に置く')
    await page.locator('.headRow .right').evaluate(el => { el.style.display = 'flex' })
    const broken = await positions()
    assert.ok(Math.abs(broken.number.right - broken.bodyNumber.right) > 20, 'text-alignが効かなくなる故障も検出する')
  } finally { await browser.close() }
})

test('B-243：引き出し600への画面側上書きを検出し、480/540と配信作成1160は通す', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}})
    for (const width of [480,540,600,1160]) {
      await page.setContent(shell(`<aside data-design-part="drawer" ${width===1160?'data-width="composer"':''} style="width:${width}px;height:300px;background:white">内容</aside>`))
      const failures = (await page.evaluate(scan)).filter(f=>f.kind==='drawerwidth')
      assert.equal(failures.length, width===600?1:0)
    }
  } finally { await browser.close() }
})

test('余白を指定した広い引き出しは3幅で収まり、元の幅や余分な縮小を検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const viewport of [1152, 1440, 1920]) {
      await page.setViewportSize({ width: viewport, height: 900 })
      const expected = Math.min(1160, viewport - 32)
      for (const width of [expected, expected - 32, expected + 32]) {
        await page.setContent(shell(`<aside data-design-part="drawer" data-width="composer" data-viewport-inset style="width:${width}px;height:300px;background:white">内容</aside>`))
        const failures = (await page.evaluate(scan)).filter(f => f.kind === 'drawerwidth')
        assert.equal(failures.length, width === expected ? 0 : 1)
      }
      await page.setContent(shell(`<aside data-design-part="drawer" data-width="composer" style="width:${Math.min(1160, viewport)}px;height:300px;background:white">内容</aside>`))
      assert.equal((await page.evaluate(scan)).filter(f => f.kind === 'drawerwidth').length, 0)
    }
  } finally { await browser.close() }
})
