import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import scanCreateConsistency from './create-consistency-browser.mjs'
import scanFormRules from './form-rules-browser.mjs'
import scanFixPatterns from './fix-patterns-browser.mjs'
import './status-steps-layout.test.mjs'

import { assessAgainstBase, measurePage, record, validateAllowances } from './layout-defects.mjs'
const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8');
const actions=()=>readFileSync(new URL('../../src/components/shared/action-list.module.css',import.meta.url),'utf8');
const row='<div class="item" data-action-row><div class="row"><span class="icon">◆</span><div class="details"><button class="titleButton" data-action-name>本人にLINEで知らせる</button><div class="extra" data-action-value>成果1件ごとに</div></div><button aria-label="その他操作">…</button></div></div>';

test('名前の行の右端は共通選択の外枠で測り、外枠が縮む故障を検出する', async () => {
 const css = readFileSync(new URL('../../src/components/shared/entity-picker.module.css', import.meta.url), 'utf8')
 const browser = await connectGuardBrowser()
 try {
  const page = await browser.newPage()
  for (const width of [1152, 1440, 1920]) {
   await page.setViewportSize({width, height:900})
   await page.setContent(`<style>${globals.replace(/@theme\s*\{/g, ':root {')}${css}*{box-sizing:border-box}</style><div data-theme="v8"><main><div data-form-row="name-folder" style="display:grid;grid-template-columns:1fr 200px;gap:16px;width:600px"><div>名前</div><div><div class="field" data-entity-picker-field><button class="fieldTrigger" aria-haspopup="dialog">分類</button><span class="fieldValue">分類なし</span></div></div></div></main></div>`)
   const defects = () => page.evaluate(scanFormRules).then(rows => rows.filter(row => row.kind === 'form-row-end'))
   const inset = await page.locator('[data-entity-picker-field]').evaluate(el => el.getBoundingClientRect().right - el.querySelector('button').getBoundingClientRect().right)
   assert.equal(inset, 1, '共通枠のborderの内側にある操作を測ると1pxになる')
   assert.equal((await defects()).length, 0)
   await page.addStyleTag({content:'[data-entity-picker-field]{width:calc(100% - 10px)}'})
   assert.equal((await defects()).length, 1, '外枠の不足は許可せず検出する')
  }
 } finally { await browser.close() }
})
const html=css=>`<style>${globals}${css}</style><div data-theme="v8"><main style="width:650px"><section data-page-template="create">${row}</section></main></div>`;
test('Y1 実物の行CSSで名前と値は同じ文字サイズで隣り合い、広い名前枠へ戻す故障を落とす',async()=>{
 const browser=await connectGuardBrowser();try{const page=await browser.newPage();await page.setContent(html(actions()));const good=await page.evaluate(scanCreateConsistency);assert.equal(good.counts.Y1,0,JSON.stringify(good.rows));
 await page.addStyleTag({content:'.titleButton{flex:1}.extra{font-size:16px}'});assert.ok((await page.evaluate(scanCreateConsistency)).counts.Y1>0);
 await page.setContent(html(actions()));assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y1,0);
 }finally{await browser.close()}
});

test('Y2 実物の作成型CSSで右欄は白い板と同じ地、灰色へ戻す故障を落としplainも保つ',async()=>{
 const css=readFileSync(new URL('../../src/components/templates/page-templates.module.css',import.meta.url),'utf8').replace(/:global\(([^()]*)\)/g,'$1');
 const content=`<style>${globals}${css}</style><div data-theme="v8"><main style="width:900px"><section class="frame" data-standalone data-page-template="create"><aside class="preview" data-template-region="preview"><div class="previewContent">設定のカード</div></aside></section></main></div>`;
 const browser=await connectGuardBrowser();try{const page=await browser.newPage();await page.setContent(content);assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y2,0);
 await page.addStyleTag({content:'[data-page-template="create"] .preview{background:#f7f8fa!important}'});assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y2,1);
 await page.setContent(content.replace('class="preview"','class="otherRail"')+'<style>.otherRail{width:380px;padding:24px;background:#f7f8fa}</style>');assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y2,0);
 await page.setContent(content);await page.locator('.preview').evaluate(e=>e.setAttribute('data-preview-surface','plain'));assert.equal(await page.locator('.preview').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 }finally{await browser.close()}
});

test('Y3 作る題と編集のパンくずの不一致を落とし、同じ状態の題なら通す',async()=>{
 const browser=await connectGuardBrowser();try{const page=await browser.newPage();await page.setContent('<nav aria-label="パンくず"><h1>ルールを編集・基本設定</h1></nav><main><section data-page-template="create"><h2>ルールを作る</h2></section></main>');assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y3,1);
 await page.locator('nav h1').evaluate(e=>e.textContent='ルールを作る・基本設定');assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y3,0);
 await page.locator('main h2').evaluate(e=>e.textContent='ルールを編集');await page.locator('nav h1').evaluate(e=>e.textContent='ルールを編集・基本設定');assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y3,0);
 }finally{await browser.close()}
});

test('Y4 主保存の実SVGを数え、チェック・印なし・二重印の故障を落とす',async()=>{
 const browser=await connectGuardBrowser();try{const page=await browser.newPage();
 const button=icons=>`<main><div data-sticky-actions><button class="button_primary_x">${icons}保存する</button></div></main>`;
 const svg=kind=>`<svg class="lucide lucide-${kind}" width="16" height="16"><path d="M0 0L16 16" /></svg>`;
 for(const icons of [svg('check'),'',svg('save')+svg('check')]){await page.setContent(button(icons));assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y4,1);}
 await page.setContent(button(svg('save')));assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y4,0);
 await page.locator('button').evaluate(e=>{e.textContent='保存中…';e.setAttribute('aria-busy','true')});assert.equal((await page.evaluate(scanCreateConsistency)).saves.length,0);
 await page.setContent(button(svg('arrow-right')).replace('保存する','次へ'));assert.equal((await page.evaluate(scanCreateConsistency)).saves.length,0);
 }finally{await browser.close()}
});

test('言葉の追加は札の隣の箱つき入力で、枠なしと名前なしの札を検出する', async () => {
 const fieldCss = readFileSync(new URL('../../src/components/shared/text-field.module.css', import.meta.url), 'utf8')
 const entryCss = readFileSync(new URL('../../src/components/shared/keyword-input.module.css', import.meta.url), 'utf8')
 const browser = await connectGuardBrowser()
 try {
  const page = await browser.newPage()
  for (const width of [1440, 1152, 1920]) {
   await page.setViewportSize({ width, height: 900 })
   await page.setContent(`<style>${globals}${fieldCss}${entryCss}</style><div data-theme="v8"><main><div style="display:flex;gap:8px;width:400px;align-items:center">
     <span>予約変更</span><span data-keyword-input class="entry"><span class="field single affixed"><span class="adornment">検索</span><input class="field single affixedControl" placeholder="言葉を入れて Enter" aria-label="言葉を足す"></span></span></div></main></div>`)
   const defects = () => page.evaluate(scanFormRules).then(rows => rows.filter(row => row.kind === 'form-keyword-input'))
   assert.equal((await defects()).length, 0)
   const boxes = await page.locator('[data-keyword-input]').evaluate(el => ({ width: el.getBoundingClientRect().width, parent: el.parentElement.getBoundingClientRect().width }))
   assert.ok(boxes.width > 0 && boxes.width <= boxes.parent)
   await page.addStyleTag({ content: 'html:root [data-keyword-input] > span{border:0;outline:0}' })
   assert.equal((await defects()).length, 1, '枠を落とした故障を止める')
   await page.setContent('<main><div data-form-requirement="optional"><label><svg width="14" height="14"></svg></label><span>任意</span><input style="border:0" placeholder="言葉を入れて Enter"></div></main>')
   assert.equal((await defects()).length, 1, '素の欄と名前のない札へ戻る故障を止める')
  }
 } finally { await browser.close() }
})

test('Y1〜Y4の説明値を保ち、数値の実測で本線比較・新規・件数増加・悪化を判定する',async()=>{
 const browser=await connectGuardBrowser();try{const page=await browser.newPage();
 const fixtures=[
  ['form-action-value','<main><div data-action-row style="--tpl-action-row-gap:12px"><span data-action-name style="font-size:14px">名前</span><span data-action-value style="font-size:16px">値</span></div></main>','nameSize'],
  ['form-preview-surface','<main><section data-page-template="create" style="background:white"><aside data-template-region="preview" style="background:#f7f8fa">見本</aside></section></main>','bg'],
  ['form-create-title','<nav aria-label="パンくず"><h1>ルールを編集</h1></nav><main><h2>ルールを作る</h2></main>','breadcrumb'],
  ['form-save-icon','<main><div data-sticky-actions><button class="button_primary_x">保存する<svg class="lucide lucide-check" width="16" height="16"></svg></button></div></main>','icons'],
 ];
 for(const [kind,markup,detailKey] of fixtures){
  await page.setContent(markup);
  const findings=(await measurePage(page)).filter(f=>f.kind===kind);
  assert.equal(findings.length,1,kind);
  const f=findings[0];assert.ok(detailKey in f.detail,kind);
  assert.ok(Object.values(f.measure).every(n=>Number.isFinite(n)&&n>=0),JSON.stringify(f));
  const fixed=validateAllowances(record(findings,'/fixture',1152,'既存の故障対照'));
  const compare=values=>assessAgainstBase(values,findings,'/fixture',1152);
  assert.equal(compare(findings).existing.length,1,kind);
  assert.equal(compare([]).failures.length,0,kind);
  assert.equal(compare([f,f]).failures.length,1,kind);
  assert.equal(compare([{...f,target:'aside.new'}]).failures.length,1,kind);
  for(const key of Object.keys(f.measure)){
   const worse={...f,measure:{...f.measure,[key]:f.measure[key]+1}};
   assert.equal(compare([worse]).failures.length,1,kind+' '+key);
   assert.equal(assessAgainstBase([worse],findings,'/fixture',1152,fixed).failures.length,1,kind+' 固定許可');
  }
  assert.equal(assessAgainstBase(findings,[],'/fixture',1152).failures.length,1,kind+' 新規');
  assert.throws(()=>validateAllowances([{...fixed[0],measure:f.detail}]),kind+' 説明値を許可の実寸に混ぜない');
 }
 }finally{await browser.close()}
});


test('最近の配信の日時と複製操作は全3幅で離れ、接触と重なりの故障を止める', async () => {
 const css = readFileSync(new URL('../../src/components/broadcasts/broadcast-form-v8.module.css', import.meta.url), 'utf8').replace(/:global\(([^()]*)\)/g, '$1')
 const globalCss = globals.replace(/@theme\s*\{/g, ':root {')
 const browser = await connectGuardBrowser()
 try {
  const page = await browser.newPage()
  const content = root => `<style>${globalCss}${css}*{box-sizing:border-box}button{font:inherit}</style><div data-theme="v8"><main><section data-page-template="create"><div class="${root ? 'root' : ''}" style="width:650px"><div class="recentRow"><svg width="14" height="14"></svg><span class="recentName">長い最近の配信の名前</span><span>2026/10/14 11:00 送信 ・ 34,080 人</span><button>複製する</button></div></div></section></main></div>`
  const scan = () => page.evaluate(scanFixPatterns).then(result => result.findings.filter(row => row.reason.includes('recent broadcast metadata')))
  for (const width of [1152, 1440, 1920]) for (const root of [false, true]) {
   await page.setViewportSize({ width, height: 900 })
   await page.setContent(content(root))
   assert.equal((await scan()).length, 0)
   const gap = await page.locator('.recentRow').evaluate(row => {
    const range = document.createRange(); range.selectNodeContents(row.children[2])
    return row.children[3].getBoundingClientRect().left - range.getBoundingClientRect().right
   })
   assert.ok(gap >= 8, `gap=${gap}, width=${width}, root=${root}`)
   assert.ok(await page.locator('.recentRow').evaluate(row => parseFloat(getComputedStyle(row).paddingTop) > 0))
   await page.addStyleTag({ content: '.recentRow{gap:0}' })
   assert.equal((await scan()).length, 1, '文字と操作の接触を拾う')
   await page.addStyleTag({ content: '.recentRow button{transform:translateX(-4px)}' })
   assert.equal((await scan()).length, 1, '重なりも拾う')
   await page.setContent(content(root))
   assert.equal((await scan()).length, 0, '共通CSSへ戻すと解消')
  }
 } finally { await browser.close() }
})
