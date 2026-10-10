import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import scan from './pendec2-rules-browser.mjs'
const shell = body => `<style>*{box-sizing:border-box}body{margin:0;font:13px/20px sans-serif}p{margin:0}button{font:inherit}svg{width:16px;height:16px}</style><main>${body}</main>`
const card = (content, style='') => `<section data-rule-card style="border:1px solid #ccc;width:200px;padding:16px;${style}">${content}</section>`
const choice = (style, radioStyle='right:16px;top:16px', checked=true) => `<label data-choice-card style="position:relative;display:block;width:200px;height:100px;padding:16px;border:1px solid #087a3e;${style}"><input type="radio" ${checked?'checked':''} style="position:absolute;width:18px;height:18px;margin:0;${radioStyle}">選ぶ</label>`
const segment = buttons => `<div data-segmented-control>${buttons}</div>`
const goodSegment = '<button aria-pressed="true" style="background:#e8f5ec;color:#087a3e;border:1px solid #087a3e">選択</button>'
const cases = {
  liffshadow: ['<section data-liff-card style="padding:16px">内容</section>', '<section data-liff-card style="padding:16px;box-shadow:0 1px 1px rgba(29,29,31,.16),0 2px 4px rgba(29,29,31,.08)">内容</section>'],
  liffradio: ['<div data-liff-root><input type="radio" checked style="width:24px;height:24px"></div>', '<div data-liff-root><input type="radio" checked style="width:18px;height:18px;background:radial-gradient(circle,#087a3e 4.5px,white 4.5px)"></div>'],
  cardspill:[card('<p style="width:240px">はみ出す内容</p>'),card('<p>内容</p>')],
  cardbottom:[card('<p>最後の行</p>','padding-bottom:0'),card('<p>最後の行</p>')],
  canvasbottom:['<div data-page-template="detail"><p>本文</p></div>','<div data-page-template="detail" style="padding-bottom:24px"><p>本文</p></div>'],
  segempty:[segment(goodSegment+'<button></button>'),segment(goodSegment+'<button>ほか</button>')],
  segselected:[segment(goodSegment+goodSegment),segment(goodSegment+'<button>ほか</button>')],
  segstyle:[segment(goodSegment.replace('#e8f5ec','#eee')),segment(goodSegment)],
  'choice-radio':[choice('background:#e8f5ec','left:16px;top:16px'),choice('background:#e8f5ec')],
  'choice-color':[choice('background:#eee'),choice('background:#e8f5ec')],
  pageredge:['<nav data-pagination><button style="border:0">次へ</button></nav>','<nav data-pagination><button style="border:1px solid">次へ</button></nav>'],
  rowmenu:['<table><tbody><tr><td><button data-row-menu>…</button></td></tr><tr><td><button>編集</button></td></tr></tbody></table>','<table><tbody><tr><td><button data-row-menu>…</button></td></tr><tr><td><button data-row-menu>…</button></td></tr></tbody></table>'],
  bandtouch:['<div role="alert" style="background:#eee">案内</div>'+card('<p>箱</p>'),'<div role="alert" style="background:#eee;margin-bottom:12px">案内</div>'+card('<p>箱</p>')],
  'customer-edit':['<section data-customer-info-panel><p>名前</p></section>','<section data-customer-info-panel><button>表示項目を編集</button></section>'],
  insertoutside:['<div data-message-insert-row>差し込む</div>','<div data-message-body><div data-message-insert-row>差し込む</div></div>'],
  insertlegacy:['<button data-message-insert-button style="border:1px solid">＋ 名前</button>','<button data-message-insert-button style="border:0"><svg></svg>名前</button>'],
  'internal-window-copy':['<p>詳細の小窓</p>','<p>詳細</p>'],
  kpiblank:['<div data-kpi-strip><p data-kpi-detail style="min-height:18px"></p></div>','<div data-kpi-strip><p data-kpi-detail style="display:none"></p></div>'],
  kpialign:['<div data-kpi-strip><p data-kpi-detail data-kpi-detail-present>補足</p><p data-kpi-detail style="display:none"></p></div>','<div data-kpi-strip><p data-kpi-detail data-kpi-detail-present>補足</p><p data-kpi-detail style="min-height:18px"></p></div>'],
}
test('B-219〜233の19種類は故障注入で落ち、修正後は0（1152・1440・1920）', async () => {
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage()
    for(const width of [1152,1440,1920]) {
      await page.setViewportSize({width,height:900})
      for(const [kind,[broken,fixed]] of Object.entries(cases)) {
        await page.setContent(shell(broken))
        assert.ok((await page.evaluate(scan)).some(f=>f.kind===kind),`${width}: 故障の見逃し ${kind}`)
        await page.setContent(shell(fixed))
        assert.deepEqual(await page.evaluate(scan),[],`${width}: 修正後 ${kind}`)
      }
    }
    await page.setContent(shell('<section data-rule-card style="outline:1px solid;width:200px;padding:16px"><p style="width:240px">輪郭枠のはみ出し</p></section>'))
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='cardspill'))
    await page.setContent(shell('<div data-message-body><div data-message-insert-row><div class="insertRow_old"><button data-message-insert-button style="border:0"><svg></svg>名前</button></div></div></div>'))
    assert.deepEqual(await page.evaluate(scan),[])
  } finally { await browser.close() }
})
test('故障した見張りをCLIが終了1で止める（無断の許可追加なし）', () => {
  const dir=mkdtempSync(join(tmpdir(),'pendec2-guard-'))
  try {
    const file=join(dir,'cases.json')
    writeFileSync(file,JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k,[html]])=>[k,shell(html)]))))
    const result=spawnSync(process.execPath,['apps/web/scripts/v8-guard/layout-defects.mjs','--fixtures',file],{encoding:'utf8',timeout:60000})
    assert.equal(result.status,1,result.stdout+result.stderr)
    for(const kind of Object.keys(cases)) assert.match(result.stdout,new RegExp('  '+kind+' '))
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('実物CSS：全部空なら90、1マスに補足があれば116で全マスを揃える。統括の帯にも効く', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const read = path => readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8')
    const cells = [0,1,2,3].map(i => `<div class="card" data-design-version="v8" data-kpi-presentation="band"><p class="head">項目 ${i}</p><div class="value"><b data-kpi-number>12</b></div><p class="detail" data-kpi-detail><span></span></p></div>`).join('')
    await page.setContent(`<html data-theme="v8"><style>*{box-sizing:border-box}p{margin:0}${read('app/globals.css')}${read('components/shared/kpi-card.module.css')}${read('components/shared/kpi-band-v8.css')}</style><body><div data-list-skeleton><div data-kpi-strip data-kpi-presentation="band">${cells}</div></div></body></html>`)
    const heights = () => page.locator('[data-design-version]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
    assert.deepEqual(await heights(), [90,90,90,90])
    assert.equal(await page.locator('[data-kpi-detail]').first().evaluate(el=>getComputedStyle(el).display),'none')
    await page.locator('[data-kpi-detail]').first().evaluate(el=>{el.setAttribute('data-kpi-detail-present','');el.firstChild.textContent='補足'})
    assert.deepEqual(await heights(), [116,116,116,116])
    assert.deepEqual(await page.locator('[data-kpi-detail]').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).display)), ['flex','flex','flex','flex'])
    await page.locator('[data-list-skeleton]').evaluate(el=>el.removeAttribute('data-list-skeleton'))
    await page.locator('[data-kpi-detail]').first().evaluate(el=>{el.removeAttribute('data-kpi-detail-present');el.firstChild.textContent=''})
    assert.deepEqual(await page.locator('[data-kpi-detail]').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).display)), ['none','none','none','none'])
  } finally { await browser.close() }
})

// アプリと配備用Clientの入口が同じCSSを読むことも守る。
test('LIFFの実物CSSは白いカードだけに影を付け、ラジオは18・点9', async () => {
  const surface=readFileSync(new URL('../../../liff/src/card-surface.css',import.meta.url),'utf8')
  for(const entry of ['index.css','embedded.css']) assert.match(readFileSync(new URL('../../../liff/src/'+entry,import.meta.url),'utf8'),/card-surface\.css/)
  for(const entry of ['affiliate','event-booking','salon-booking','webinar','nen-member']) assert.match(readFileSync(new URL('../../../worker/src/client/'+entry+'/styles.css',import.meta.url),'utf8'),/card-surface\.css/)
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage()
    await page.setContent(`<style>${surface}</style><main data-liff-root><section data-liff-card style="padding:16px">内容</section><section data-liff-card data-selected style="padding:16px">選択</section><button>操作</button><input type="radio" checked></main>`)
    assert.deepEqual(await page.evaluate(scan),[])
    assert.equal(await page.locator('[data-selected]').evaluate(el=>getComputedStyle(el).boxShadow),'none')
    assert.equal(await page.locator('button').evaluate(el=>getComputedStyle(el).boxShadow),'none')
    await page.locator('input').evaluate(el=>el.style.width='24px')
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='liffradio'))
    await page.locator('[data-liff-card]').first().evaluate(el=>el.style.boxShadow='none')
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='liffshadow'))
  } finally { await browser.close() }
})

test('実物CSS：停止確認のラジオ行はカードの選択枠を引き継がない', async () => {
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage()
    const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8')
    const radio=readFileSync(new URL('../../src/components/shared/radio-card.module.css',import.meta.url),'utf8')
    await page.setContent(`<html data-theme="v8"><style>${globals}${radio}</style><main><label class="card row checked" data-variant="row"><input class="radio" type="radio" checked><span class="body"><b class="title">止める</b></span></label></main></html>`)
    assert.equal(await page.locator('label').evaluate(el=>getComputedStyle(el).outlineColor),'rgba(0, 0, 0, 0)')
    assert.equal(await page.locator('input').evaluate(el=>el.getBoundingClientRect().width),18)
  } finally { await browser.close() }
})

test('実物CSS：差し込み行の項目は8px、印と字は4px。未定義の値でくっつかない', async () => {
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage()
    const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8')
    const insert=readFileSync(new URL('../../src/components/shared/message-insert-row.module.css',import.meta.url),'utf8')
    await page.setContent(`<style>${globals}${insert}</style><main><div class="body" data-message-body><textarea>本文</textarea><div class="row" data-message-insert-row><div class="controls"><span class="label">差し込む</span><button class="button" data-message-insert-button><svg></svg>名前</button></div><span class="count">2 / 5,000</span></div></div></main>`)
    assert.equal(await page.locator('.controls').evaluate(el=>getComputedStyle(el).columnGap),'8px')
    assert.equal(await page.locator('.button').evaluate(el=>getComputedStyle(el).columnGap),'4px')
    assert.equal(await page.locator('.row').evaluate(el=>getComputedStyle(el).columnGap),'12px')
    await page.locator('.button').evaluate(el=>el.style.gap='0px')
    assert.notEqual(await page.locator('.button').evaluate(el=>getComputedStyle(el).columnGap),'4px')
  } finally { await browser.close() }
})
