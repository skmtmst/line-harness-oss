/** B-187: 1152/1440 の大きな空白を止める。
 * node apps/web/scripts/v8-guard/blank-gap.mjs <baseUrl> [out.json]
 * node apps/web/scripts/v8-guard/blank-gap.mjs --self-test
 * 空白−24 >=96 は失敗、48〜95は報告のみ。
 * 数の帯は全マスの下端に、中身+16より24以上の余りがある時だけ失敗。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { ROUTES, openPage } from './browser-env.mjs'
import scanBlankGap from './blank-gap-browser.mjs'

const allow = JSON.parse(readFileSync(new URL('./blank-gap-allow.json', import.meta.url), 'utf8'))
if (!Array.isArray(allow) || allow.some(a => !a.route || !a.owner || !a.reason?.trim() || ![1152,1440].includes(a.width) || !Number.isFinite(a.maxExcess))) throw new Error('空白の許容表には画面・幅・持ち主・上限・理由が必要です')
export const GAP_ROUTES = {
  ...Object.fromEntries(Object.entries(ROUTES).filter(([name]) => name !== 'login')),
  // B-187 で空白が報告された52画面。手元の報告ファイルには依存しない。
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

// CSS Modules のビルドごとに変わる hash を許容表の識別子にしない。
export const ownerOf = finding => (finding.container?.sel ?? finding.edge?.sel ?? '').split(' > ').at(-1).replace(/__[\w-]+/g, '')
export function assess(result, route, width, allowances = allow) {
  const failures = [], warnings = [], excluded = [], allowed = []
  for (const f of result.findings) {
    if (f.excluded || f.where === 'page-bottom') { excluded.push(f); continue }
    if (f.excess < 96) { if (f.excess >= 48) warnings.push(f); continue }
    const exemption = allowances.find(a => a.route === route && a.width === width && a.owner === ownerOf(f) && f.excess <= a.maxExcess)
    if (exemption) allowed.push({ ...f, reason: exemption.reason }); else failures.push(f)
  }
  for (const b of result.bands) {
    if (b.excluded) { excluded.push(b); continue }
    if (b.cardH.length > 1 && b.cardH.every((h, i) => h - b.contentH[i] - 16 >= 24)) failures.push({ kind: 'kpi-band', ...b })
  }
  for (const d of result.invalidDeclarations ?? []) failures.push({kind:'empty-blank-ok',...d})
  return { failures, warnings, excluded, allowed, declarations: result.declarations }
}

export async function selfTest() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({viewport:{width:1152,height:900}})
    const fixture = '<main style="height:800px"><div style="background:color(srgb 0.95 0.95 0.95);padding:24px"><p>上の中身</p><div id="gap" style="min-height:240px"></div><p>下の中身</p></div></main>'
    await page.setContent(fixture)
    const broken = assess(await page.evaluate(scanBlankGap), '/test', 1152, [])
    if (!broken.failures.some(f => f.kind === 'vertical' && f.excess >= 96)) throw new Error('対照1: 240pxの空白を検出できません')
    console.log('対照1 合格: 240pxの空白を止める')
    await page.locator('#gap').evaluate(el => el.setAttribute('data-blank-ok','比較に必要な意図した空き'))
    const declared = assess(await page.evaluate(scanBlankGap), '/test', 1152, [])
    if (declared.failures.length || !declared.declarations.some(d => d.reason)) throw new Error('対照2: 理由つきの除外が効きません')
    console.log('除外 合格: 理由つきdata-blank-okだけ通す')
    await page.setContent('<main style="width:1100px;height:600px"><section style="width:240px;height:320px;background:#fafafa"><p>本文</p></section><footer style="height:40px;background:#eee">保存</footer></main>')
    const horizontal = assess(await page.evaluate(scanBlankGap), '/test', 1152, [])
    if (!horizontal.failures.some(f => f.kind === 'horizontal' && f.excess >= 96)) throw new Error('対照2: 横の空白を検出できません')
    console.log('対照2 合格: 横に偏った大きな空白を止める')
    await page.setContent('<main><div data-kpi-strip style="display:flex">'+Array.from({length:3},()=>'<div data-kpi-presentation="card" style="min-height:160px;padding:16px"><p>件数</p><p>12</p></div>').join('')+'</div></main>')
    const band = assess(await page.evaluate(scanBlankGap), '/test', 1152, [])
    if (!band.failures.some(f => f.kind === 'kpi-band')) throw new Error('対照3: 高すぎる数の帯を検出できません')
    // 1マスだけ長い時の高さそろえは通す。
    await page.locator('[data-kpi-strip] > [data-kpi-presentation]').first().evaluate(el=>el.innerHTML+='<p>'+Array.from({length:8},()=> '長い中身<br>').join('')+'</p>')
    if (assess(await page.evaluate(scanBlankGap), '/test',1152,[]).failures.some(f=>f.kind==='kpi-band')) throw new Error('数の帯の高さそろえを誤検出しました')
    console.log('対照3 合格: 全マスが高すぎる帯を止め、長い1マスへの高さそろえは通す')
  } finally { await browser.close() }
}

async function run() {
  if (process.argv.includes('--self-test')) return selfTest()
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
        const result=assess(await page.evaluate(scanBlankGap),route,width)
        results[`${width} ${name}`]=result
        bad+=result.failures.length
        for (const failure of result.failures) console.log('  停止', failure.kind, ownerOf(failure), failure.excess ?? failure.cardH)
        for (const warning of result.warnings) console.log('  参考', warning.kind, ownerOf(warning), warning.excess)
        for (const permitted of result.allowed) console.log('  許容', ownerOf(permitted), permitted.excess, permitted.reason)
        console.log(`${result.failures.length ? '空白 NG' : '空白 OK'} ${width} ${route}: 停止${result.failures.length}・参考${result.warnings.length}・許容${result.allowed.length}`)
      } catch(error) {bad++;results[`${width} ${name}`]={error:error.message};console.error('測定失敗',width,route,error.message)}
      finally {await page?.close()}
    }
  } finally {await browser.close()}
  if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(results,null,2))}
  console.log(`空白の停止件数 ${bad}`)
  if(bad)process.exitCode=1
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run()
