/** 実際の設定入口から固定予約見本・履歴・色変更を確認。保存・実予約はしない。 */
import {chromium} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {openPage,WIDTHS} from './browser-env.mjs'
const [base,out]=process.argv.slice(2)
mkdirSync(out,{recursive:true})
const browser=await chromium.launch(),results=[]
const checkpoint=error=>writeFileSync(join(out,'results.json'),`${JSON.stringify({complete:results.length===WIDTHS.length&&!error,error,results},null,2)}\n`)
checkpoint()
try {
 for(const width of WIDTHS) {
  const page=await openPage(browser,{baseUrl:base,route:'/settings/customer-look',width,theme:'v8',stable:true,requireSuccess:true})
  try {
   const tabs=page.getByRole('tablist',{name:'見本の画面',includeHidden:true})
   await tabs.waitFor({state:'attached'})
   if(!await tabs.isVisible()) {
    if(width!==1152) throw new Error('広い幅で予約見本が表示されません')
    await page.screenshot({path:join(out,`${width}.png`)})
    results.push({width,previewCollapsed:true});checkpoint();continue
   }
   const preview=page.locator('[class*="customer-look-preview_preview"]')
   const check=async()=>{
    const date=await preview.locator('[class*="week"] [data-selected]').evaluate(e=>({day:e.firstChild.textContent,date:e.querySelector('strong').textContent}))
    const time=await preview.locator('[class*="times"] [data-selected]').innerText()
    const summary=await preview.locator('[class*="footer"] p').innerText()
    const expected=`10月${date.date}日（${date.day}）${time}`
    if(summary!==expected) throw new Error(`選択 ${expected} / 確認 ${summary}`)
    return summary
   }
   const summary=await check()
   await tabs.getByRole('tab',{name:'予約の履歴'}).click()
   if(await preview.locator('[class*="sample"] strong').innerText()!==summary) throw new Error('履歴の日付が一致しません')
   await tabs.getByRole('tab',{name:'予約',exact:true}).click()
   await page.getByRole('radio',{name:/モダン/}).click()
   await check()
   await page.getByRole('radio',{name:/ナチュラル/}).click()
   await check()
   await preview.screenshot({path:join(out,`${width}.png`)})
   results.push({width,summary,tabRoundtrip:true,paletteChanged:true})
   checkpoint()
  } finally {await page.close()}
 }
} catch(error) {checkpoint(error.message);console.error(error);process.exitCode=1}
finally {await browser.close()}
