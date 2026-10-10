/** B-191/192: Pen と同じ崩れ判定。既存 V8 guard と同じ必須 CI。
 * node apps/web/scripts/v8-guard/layout-defects.mjs <baseUrl> [out.json]
 * --record-allow <path> --reason <理由> は手元で既存違反を採取する時だけ使う。
 * --fixtures <json> は種類別のHTMLを1つのブラウザで順に検証する。
 * --fixture <html> は対照試験用（許可リストを使わず終了コードを確かめる）。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES, WIDTHS, openPage } from './browser-env.mjs'
import scanLayoutDefects from './layout-defects-browser.mjs'
import scanPendec2Rules from './pendec2-rules-browser.mjs'
import scanOwnerRules from './owner-rules-browser.mjs'
import scanPanelBlank from './panel-blank-browser.mjs'
import scanBlankGap from './blank-gap-browser.mjs'
const GAP_ROUTES = JSON.parse(readFileSync(new URL('./layout-defects-routes.json',import.meta.url),'utf8'))

export const DEFECT_ROUTES = { ...ROUTES, tags: '/tags', affiliates: '/affiliates', 'inflow-links': '/inflow-links', conversions: '/conversions', ...Object.fromEntries(GAP_ROUTES.map(route=>[route,route])) }
export const keyOf = f => JSON.stringify([f.kind, f.target, f.other || '', f.text])
const KINDS = ['liffshadow','liffradio','canvasbottom','kpiblank','kpialign','cardspill','cardbottom','segempty','segselected','segstyle','choice-radio','choice-color','pageredge','rowmenu','bandtouch','customer-edit','insertoutside','insertlegacy','internal-window-copy', 'wrap', 'squash', 'clip', 'overlap', 'touch', 'blank', 'blank-vertical', 'blank-horizontal', 'blank-kpi', 'empty-blank-ok', 'align', 'missing', 'short', 'tallrow', 'blue', 'tight', 'rowbg', 'dark', 'boxclip', 'footgap', 'edge', 'inset', 'greenname', 'shortname']
export function validateAllowances(allowances) {
  if (!Array.isArray(allowances)) throw new Error('許可リストは配列です')
  const keys = new Set()
  for (const a of allowances) {
    if (!a.route || !WIDTHS.includes(a.width) || !KINDS.includes(a.kind) || !a.target || !a.reason?.trim() ||
        !Number.isInteger(a.count) || a.count < 1 || !a.measure || !Object.keys(a.measure).length ||
        Object.values(a.measure).some(n => !Number.isFinite(n) || n < 0)) throw new Error('許可には画面・幅・種類・対象・件数・実寸・理由が必要です')
    const id = JSON.stringify([a.route, a.width, keyOf(a)])
    if (keys.has(id)) throw new Error('同じ違反の許可が重複しています')
    keys.add(id)
  }
  return allowances
}
export function assess(findings, route, width, allowances) {
  validateAllowances(allowances)
  const used = new Map(), failures = [], allowed = []
  for (const f of findings) {
    if (f.kind === 'empty-blank-ok') { failures.push(f); continue }
    const key = keyOf(f)
    const a = allowances.find(a => a.route === route && a.width === width && keyOf(a) === key)
    const count = (used.get(key) || 0) + 1; used.set(key, count)
    // くっつきは間が小さいほど悪化。ほかは値が大きいほど悪化。
    const within = a && Object.entries(f.measure).every(([k, n]) => Number.isFinite(a.measure[k]) && (k === 'gap' && f.kind === 'touch' ? n >= a.measure[k] : n <= a.measure[k]))
    if (a && count <= a.count && within) allowed.push({ ...f, reason: a.reason })
    else failures.push(f)
  }
  return { failures, allowed }
}
export function record(findings, route, width, reason) {
  const groups = new Map()
  for (const f of findings) {
    const key = keyOf(f), old = groups.get(key)
    if (old) {
      old.count++
      for (const [k,n] of Object.entries(f.measure)) old.measure[k] = k === 'gap' && f.kind === 'touch' ? Math.min(old.measure[k], n) : Math.max(old.measure[k], n)
    } else groups.set(key, { route, width, ...f, measure: { ...f.measure }, count: 1, reason: reason + '。対象：' + f.text })
  }
  return [...groups.values()]
}
export async function measurePage(page) {
  const panels = await page.evaluate(scanPanelBlank)
  // 下の空白は panel-blank に一本化。blankfix の途中・横・数の帯は残す。
  const gaps = await page.evaluate(scanBlankGap, { skipPanelBottom: true, exactSelectors: true, selectorDepth: 32, selectorLimit: 4096 })
  const extra = []
  for (const f of gaps.findings) {
    if (f.excluded || f.where === 'page-bottom' || f.excess < 96) continue
    extra.push({kind: 'blank-' + (f.kind === 'horizontal' ? 'horizontal' : 'vertical'), target: (f.container?.sel || f.edge?.sel || '').replace(/__[\w-]+/g,''), text: [f.where,f.prev?.text,f.next?.text].filter(Boolean).join(' → '), measure:{excess:f.excess}})
  }
  for (const b of gaps.bands) {
    if (!b.excluded && b.cardH.length > 1 && b.cardH.every((h,i)=>h-b.contentH[i]-16>=24))
      extra.push({kind:'blank-kpi',target:b.sel.replace(/__[\w-]+/g,''),text:'数の帯の全マスが高い',measure:{minExcess:Math.min(...b.cardH.map((h,i)=>h-b.contentH[i]-16)),maxExcess:Math.max(...b.cardH.map((h,i)=>h-b.contentH[i]-16))}})
  }
  for (const d of gaps.invalidDeclarations || []) extra.push({kind:'empty-blank-ok',target:d.selector.replace(/__[\w-]+/g,''),text:'空白の除外理由なし',measure:{count:1}})
  return [...await page.evaluate(scanLayoutDefects), ...await page.evaluate(scanOwnerRules), ...await page.evaluate(scanPendec2Rules), ...panels, ...extra]
}
async function run() {
  const { chromium } = await import('@playwright/test')
  const args = process.argv.slice(2)
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : null
  const fixture = value('--fixture'), fixturesFile = value('--fixtures'), recordPath = value('--record-allow'), reason = value('--reason'), onlyRoute = value('--route')
  if (recordPath && !reason?.trim()) throw new Error('採取には --reason が必要です')
  if (recordPath && process.env.CI) throw new Error('CI では許可リストを自動更新できません')
  const [baseUrl='http://127.0.0.1:4310',out] = args.filter((a,i) => !a.startsWith('--') && (i === 0 || !args[i-1].startsWith('--')))
  if (fixture && fixturesFile) throw new Error('対照は --fixture か --fixtures の一方だけです')
  const fixtureCases = fixture ? { fixture: readFileSync(fixture,'utf8') } : fixturesFile ? JSON.parse(readFileSync(fixturesFile,'utf8')) : null
  if (fixtureCases && (!Object.keys(fixtureCases).length || Object.values(fixtureCases).some(v=>typeof v !== 'string'))) throw new Error('対照見本は名前とHTMLの対応表です')
  const allow = fixtureCases || recordPath ? [] : validateAllowances(JSON.parse(readFileSync(new URL('./layout-defects-allow.json',import.meta.url),'utf8')))
  const routes = [...new Set(Object.values(DEFECT_ROUTES))].filter(route => !onlyRoute || route === onlyRoute)
  if (!fixtureCases && !routes.length) throw new Error('指定した画面が見張りの対象にありません')
  const browser = await chromium.launch(), results = {}, recorded = []
  let bad = 0
  try {
    for (const width of fixtureCases ? [1152] : WIDTHS) for (const route of fixtureCases ? Object.keys(fixtureCases).map(k=>'/fixture/'+k) : routes) {
      let page
      const errors = []
      try {
        if (fixtureCases) { page = await browser.newPage({viewport:{width,height:900}}); await page.setContent(fixtureCases[route.slice('/fixture/'.length)]) }
        else {
          // エラーを goto 前から数える。別の画面やエラー画面を許可リストへ採取しない。
          page = await openPage(browser,{baseUrl,route,width,theme:'v8',stable:true,settleMs:0,onPageError:e=>errors.push(e.message)})
          await page.waitForSelector(route === '/login' ? 'form' : 'main')
          if (route !== '/login') await page.waitForFunction(() => document.querySelectorAll('main h1,main h2,main input,main [data-kpi-number]').length > 0)
          await page.waitForLoadState('networkidle')
          await page.evaluate(() => document.fonts.ready.then(() => true))
          if (new URL(page.url()).pathname !== new URL(route,baseUrl).pathname || errors.length || (await page.locator('body').innerText()).includes('画面を表示できませんでした')) throw new Error(errors.join('; ') || '指定画面を開けませんでした')
        }
        const findings = await measurePage(page)
        recorded.push(...record(findings,route,width,reason || ''))
        const result = assess(findings,route,width,allow)
        results[`${width} ${route}`] = result
        bad += result.failures.length
        console.log(`崩れ ${width} ${route}: 新規${result.failures.length}・許可${result.allowed.length}`)
        for (const f of result.failures) console.log(`  ${f.kind} ${f.target} ${JSON.stringify(f.measure)} ${f.text}`)
      } catch (error) { bad++; results[`${width} ${route}`] = {error:error.message}; console.error('測定失敗',width,route,error.message) }
      finally { await page?.close() }
    }
  } finally { await browser.close() }
  if (out) { mkdirSync(dirname(out),{recursive:true}); writeFileSync(out,JSON.stringify(results,null,2)+'\n') }
  if (recordPath) {
    if (Object.values(results).some(r=>r.error)) throw new Error('測定失敗があるため許可リストを保存しません')
    mkdirSync(dirname(recordPath),{recursive:true}); writeFileSync(recordPath,JSON.stringify(recorded,null,2)+'\n')
  }
  if (bad && !recordPath) process.exitCode = 1
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run()
