import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chromium} from '@playwright/test'
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
   await page.setContent(html(css.replace(/html\[data-theme='v8'\] \.current\s*\{[^}]*\}/,' ')));assert.deepEqual(await colors(),['rgb(74, 85, 101)','rgb(74, 85, 101)'],'選択色の指定欠けを検出')
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
