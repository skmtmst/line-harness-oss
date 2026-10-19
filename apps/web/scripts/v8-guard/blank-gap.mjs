/** 空白量の診断。測定結果を報告し、見た目の合否には使わない。 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { ROUTES, openPage } from './browser-env.mjs'
import scanBlankGap from './blank-gap-browser.mjs'

export const GAP_ROUTES = {
  ...Object.fromEntries(Object.entries(ROUTES).filter(([name]) => name !== 'login')),
  //  で空白が報告された52画面。手元の報告ファイルには依存しない。
  ...Object.fromEntries([
    "/accounts/new",
    "/affiliates/new",
    "/analytics/reports/new",
    "/analytics/reports/new?id=report-weekly-friends",
    "/auto-replies/edit",
    "/auto-replies/edit?id=ar-new&step=confirm",
    "/auto-replies/edit?id=ar-new&step=priority",
    "/auto-replies/edit?id=ar-new&step=trigger",
    "/chats",
    "/conversions/new",
    "/conversions/new?name=商品を買った",
    "/form-submissions/edit?id=form-1",
    "/form-submissions/edit?id=form-1&tab=after",
    "/friend-add-settings/publish?id=rule-shop",
    "/friend-add-settings?view=edit&id=rule-autumn&step=message",
    "/friends/migrations",
    "/hq/billing",
    "/hq/broadcasts/detail",
    "/inflow-links/detail?id=er-1",
    "/mileage/earning-rules/new",
    "/mileage/rewards/edit",
    "/nen-members",
    "/reminders/new",
    "/restaurant-test/dashboard",
    "/restaurant-test/google?tab=posts&view=new&kind=offer",
    "/restaurant-test/google?tab=reviews&view=draft&id=rv-2",
    "/restaurant-test/inventory?tab=closures",
    "/restaurant-test/reservations",
    "/restaurant-test/stores/new",
    "/rich-menus/edit?id=rmg-1&step=publish",
    "/rich-menus/edit?id=rmg-1&step=targeting",
    "/rich-menus/new",
    "/rich-menus/new?id=rmg-draft&step=buttons",
    "/scenarios",
    "/scenarios/detail?id=scenario-0",
    "/scenarios/detail?id=scenario-0-paused",
    "/scenarios/first-step?id=scenario-0",
    "/tags/edit?id=tag-ec-customer",
    "/tags/searches/edit?id=ss-1",
    "/templates/carousel?visual=1",
    "/templates/detail?id=template-1",
    "/templates/edit",
    "/templates/edit?id=template-80",
    "/templates/edit?kind=coupon&visual=1",
    "/templates/edit?kind=research&visual=1",
    "/templates/edit?kind=rich_message&visual=1",
    "/webhooks/new",
    "/webinars/edit?id=webinar-1&pane=comments",
    "/webinars/edit?id=webinar-1&pane=cta",
    "/webinars/edit?id=webinar-1&pane=review",
    "/webinars/edit?id=webinar-1&pane=video",
    "/webinars/edit?id=webinar-scheduled&pane=video"
].map(route => [route, route])),
}

/** Keep all observations, including declared/excluded regions, for diagnosis only. */
export function whitespaceReport(result) {
  return { mode: 'diagnostic', ...result }
}

async function run() {
  if (process.argv.includes('--self-test')) throw new Error('空白量だけの合否は廃止しました。診断はURLを指定して実行します')
  const [baseUrl='http://127.0.0.1:4310',out]=process.argv.slice(2)
  const browser=await chromium.launch()
  const results={}
  let bad=0
  try {
    for (const width of [1152,1440]) for (const [name,route] of Object.entries(GAP_ROUTES).filter(([name,route],i,entries) => entries.findIndex(([,other]) => other === route) === i)) {
      let page
      try {
        page=await openPage(browser,{baseUrl,route,width,theme:'v8',stable:true,settleMs:0})
        await page.waitForSelector('main', {timeout:30000})
        await page.waitForFunction(() => document.querySelectorAll('main h1,main h2,main input,main [data-kpi-number]').length > 0, null, {timeout:30000})
        await page.waitForLoadState('networkidle', {timeout:30000})
        await page.evaluate(() => document.fonts.ready.then(() => true))
        if (new URL(page.url()).pathname !== new URL(route,baseUrl).pathname || !(await page.locator('main').count())) throw new Error('指定画面を開けませんでした')
        const result=whitespaceReport(await page.evaluate(scanBlankGap))
        results[`${width} ${name}`]=result
        console.log(`空白の参考測定 ${width} ${route}: ${result.findings.length}件・数の帯${result.bands.length}件（合否なし）`)
      } catch(error) {bad++;results[`${width} ${name}`]={error:error.message};console.error('測定失敗',width,route,error.message)}
      finally {await page?.close()}
    }
  } finally {await browser.close()}
  if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(results,null,2))}
  console.log(`測定失敗 ${bad}件（空白量による合否なし）`)
  if(bad)process.exitCode=1
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run()
