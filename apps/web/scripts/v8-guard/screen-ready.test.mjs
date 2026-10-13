import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {screenReady} from './screen-ready.mjs'

test('readiness ignores closed error/loading panels but rejects a visible failure',async()=>{
 const browser=await chromium.launch()
 try{const page=await browser.newPage()
 await page.setContent('<html data-theme="v8"><main><h1>一覧</h1><section hidden><p data-list-state="error">読み込めませんでした</p><p aria-busy="true">読み込み中</p></section><table><tr><td>値</td></tr></table></main></html>')
 assert.equal(await page.evaluate(screenReady,{route:'/webhooks'}),true)
 await page.locator('section').evaluate(el=>el.hidden=false)
 assert.equal(await page.evaluate(screenReady,{route:'/webhooks'}),'error')
 await page.locator('[data-list-state]').evaluate(el=>el.remove())
 assert.equal(await page.evaluate(screenReady,{route:'/webhooks'}),false)
 }finally{await browser.close()}
})
