import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chromium} from '@playwright/test'
test('本物の選ぶカードCSS: 丸の下の本文は狭めず、通常の本文は丸から離す',async()=>{
 const css=readFileSync(new URL('../../src/components/shared/radio-card.module.css',import.meta.url),'utf8')
 const picker=readFileSync(new URL('../../src/components/shared/layout-picker.module.css',import.meta.url),'utf8')
 const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8')
 const browser=await chromium.launch()
 try{
  const page=await browser.newPage()
  const html=style=>`<html data-theme="v8"><style>${globals}\n* {box-sizing:border-box}\n${style}\n${picker}</style><body><div class="list" data-preview="message"><label class="card compact tile" data-content-placement="below-indicator"><input class="radio" type="radio"><span class="body"><strong class="title">上1・下2</strong></span><span class="sample"></span></label></div><label class="card" style="width:240px"><input class="radio" type="radio"><span class="body"><strong class="title">通常の選択肢</strong></span></label></body></html>`
  const values=()=>page.locator('.tile').evaluate(el=>{const title=el.querySelector('.title'),sample=el.querySelector('.sample'),radio=el.querySelector('.radio');return {fits:title.scrollWidth<=title.clientWidth,pad:getComputedStyle(el).paddingTop,bodyPad:getComputedStyle(el.querySelector('.body')).paddingRight,clear:sample.getBoundingClientRect().top>=radio.getBoundingClientRect().bottom+8}})
  for(const width of [1440,1152]){
   await page.setViewportSize({width,height:600});await page.setContent(html(css));assert.deepEqual(await values(),{fits:true,pad:'40px',bodyPad:'0px',clear:true})
   assert.equal(await page.locator('.card:not(.tile) .body').evaluate(el=>getComputedStyle(el).paddingRight),'24px')
   const correctWidth=await page.locator('.tile .title').evaluate(el=>el.getBoundingClientRect().width)
   const bad=css.replace(/html(?:\[data-theme='v8'\]|:root) \.card:not\(\.row\)\[data-content-placement='below-indicator'\] \.body\s*\{[^}]*\}/,'')
   assert.notEqual(bad,css,'実物の本文幅の指定を取り除く')
   await page.setContent(html(bad));assert.equal(correctWidth-await page.locator('.tile .title').evaluate(el=>el.getBoundingClientRect().width),24,'本文を丸用に24px狭める故障を検出')
  }
 }finally{await browser.close()}
})
test('本物の件数欄CSS: 20 件表示を切らず、旧幅100の故障を検出する',async()=>{
 const css=readFileSync(new URL('../../src/components/shared/select.module.css',import.meta.url),'utf8')
 const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8')
 const toolbar=readFileSync(new URL('../../src/components/shared/list-toolbar.module.css',import.meta.url),'utf8').replace(/:global\(([^)]+)\)/g,'$1')
 const browser=await chromium.launch()
 try{
  const page=await browser.newPage()
  const html=style=>`<html data-theme="v8"><style>${globals}\n${css}\n${toolbar}\n${style}</style><body><div class="toolbar"><div class="root pageSize" data-design-node="niGPF"><button class="trigger closedTrigger" data-chevron="true"><span class="value">20 件表示</span><svg class="chevron"></svg></button></div></div></body></html>`
  const fits=()=>page.locator('.value').evaluate(el=>el.scrollWidth<=el.clientWidth)
  for(const width of [1440,1152]){
   await page.setViewportSize({width,height:600});await page.setContent(html(''));assert.equal(await fits(),true)
   await page.setContent(html("html:root .root.pageSize .trigger {width:100px;min-width:0}"));assert.equal(await fits(),false,'子の操作を100へ縮める故障を検出')
   await page.setContent(html("[data-theme='v8'] .toolbar [data-design-node='niGPF'] {width:100px;min-width:0}"));assert.equal(await fits(),false,'親で最小幅を解除する故障を検出')
  }
 }finally{await browser.close()}
})
test('本物の選ぶ欄CSS: wMMk6の左右12・間8・矢印16を共通値で保つ',async()=>{
 const css=readFileSync(new URL('../../src/components/shared/select.module.css',import.meta.url),'utf8')
 const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8')
 const browser=await chromium.launch()
 try{
  const page=await browser.newPage();const html=style=>`<html data-theme="v8"><style>${globals}\n${style}</style><body><div class="trigger closedTrigger" data-chevron="true"><span class="value">20件表示</span><svg class="chevron"></svg></div></body></html>`
  const values=()=>page.locator('.trigger').evaluate(el=>{const s=getComputedStyle(el);return [s.paddingLeft,s.paddingRight,s.gap,el.querySelector('svg').getBoundingClientRect().width]})
  for(const width of [1440,1152]){
   await page.setViewportSize({width,height:600});await page.setContent(html(css));assert.deepEqual(await values(),['12px','12px','8px',16])
   const bad=css.replaceAll('padding: 0 var(--tpl-select-inset)', 'padding: 0 10px 0 12px').replaceAll('gap: var(--tpl-select-gap)','gap: 6px')
   assert.notEqual(bad,css,'実物の内側と間の指定を変える')
   await page.setContent(html(bad));assert.deepEqual((await values()).slice(0,3),['12px','10px','6px'])
  }
 }finally{await browser.close()}
})
test('本物のページ送りCSS: 現在地の緑は通常セルの色に負けない（B-211）',async()=>{
 const css=readFileSync(new URL('../../src/components/shared/pagination.module.css',import.meta.url),'utf8')
 // ボタン全体のaria-current用CSSに頼らず、cursorのspanも共通部品自身で緑になる。
 const globals=':root {--color-ink-secondary:#4a5565;--color-selection-border:#087a3e;--color-selection-bg:#e8f5ec;}'
 const browser=await chromium.launch()
 try{
  const page=await browser.newPage();const html=style=>`<html data-theme="v8"><style>${globals}\n${style}</style><body><nav class="pagination"><span class="item page current" aria-current="page">1</span><button class="item page">2</button></nav></body></html>`
  const colors=()=>page.locator('.page').evaluateAll(els=>els.map(el=>getComputedStyle(el).color))
  for(const width of [1440,1152]){
   await page.setViewportSize({width,height:600});await page.setContent(html(css));assert.deepEqual(await colors(),['rgb(8, 122, 62)','rgb(74, 85, 101)'])
   const bad=css.replace(/html(?:\[data-theme='v8'\]|:root) \.current\s*\{[^}]*\}/,' ')
   assert.notEqual(bad,css,'実物の現在地の色指定を取り除く')
   await page.setContent(html(bad));assert.deepEqual(await colors(),['rgb(74, 85, 101)','rgb(74, 85, 101)'],'選択色の指定欠けを検出')
  }
 }finally{await browser.close()}
})
test('本物の共通CSS: 通常ボタンは600、文字だけの操作は400。幅を変えても値が変わらない',async()=>{
 const css=readFileSync(new URL('../../src/components/shared/button.module.css',import.meta.url),'utf8')
 const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8')
 const browser=await chromium.launch()
 try{
  const page=await browser.newPage()
  const html=style=>`<html data-theme="v8"><style>${globals}\n${style}</style><body><button class="button secondary standard">書き出す</button><button class="button inline text">変える</button></body></html>`
  const weights=()=>page.locator('button').evaluateAll(els=>els.map(el=>getComputedStyle(el).fontWeight))
  for(const width of [1440,1152]){
   await page.setViewportSize({width,height:600});await page.setContent(html(css));assert.deepEqual(await weights(),['600','400'])
   await page.setContent(html(css.replace('font-weight: var(--tpl-button-weight)','font-weight: var(--polish-weight-body)')));assert.deepEqual(await weights(),['400','400'],'本文の太さに戻す故障を再現')
  }
 }finally{await browser.close()}
})

test('本物の数の帯CSS: 単位は補足の18px。文字の大きさと数字は保つ',async()=>{
 const css=readFileSync(new URL('../../src/components/shared/kpi-card.module.css',import.meta.url),'utf8')
 const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8')
 const browser=await chromium.launch()
 try{
  const page=await browser.newPage();await page.setContent(`<html data-theme="v8"><style>${globals}\n${css}</style><body><div class="card"><span class="number">12</span><span class="unit">件</span></div></body></html>`)
  const values=await page.locator('.unit').evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.lineHeight,s.fontWeight]})
  assert.deepEqual(values,['12px','18px','400'])
 }finally{await browser.close()}
})
test('本物のメニューCSS: 組の見出しは共通ボタンの下限32に押されず30px',async()=>{
 const css=readFileSync(new URL('../../src/components/layout/sidebar.module.css',import.meta.url),'utf8')
 const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8')
 const browser=await chromium.launch()
 try{
  const page=await browser.newPage();const html=style=>`<html data-theme="v8"><style>${globals}\n${style}</style><body><aside><button class="sectionHeading sectionToggle">配信</button></aside></body></html>`
  const height=()=>page.locator('button').evaluate(el=>el.getBoundingClientRect().height)
  await page.setContent(html(css));assert.equal(await height(),30)
  await page.setContent(html(css.replace('.sectionToggle { min-height: 0;', '.sectionToggle {')));assert.equal(await height(),32)
 }finally{await browser.close()}
})
