import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chromium} from '@playwright/test'
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
