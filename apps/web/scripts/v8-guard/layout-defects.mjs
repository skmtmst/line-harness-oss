/** B-191/192: Pen と同じ崩れ判定。既存 V8 guard と同じ必須 CI。
 * node apps/web/scripts/v8-guard/layout-defects.mjs <baseUrl> [out.json]
 * --record-allow <path> --reason <理由> は手元で既存違反を採取する時だけ使う。
 * --fixtures <json> は種類別のHTMLを1つのブラウザで順に検証する。
 * --fixture <html> は対照試験用（許可リストを使わず終了コードを確かめる）。
 * --compare-url <url> は同じ検出器・API・幅で統合先も測り、新規と悪化だけを止める。
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
import scanControlOverlap from './control-overlap-browser.mjs'
import scanFormRules from './form-rules-browser.mjs'
import scanCreateConsistency from './create-consistency-browser.mjs'
import collectFormLayouts, { formColumnFindings } from './form-columns-browser.mjs'
import scanB244Rules from './b244-rules-browser.mjs'
const GAP_ROUTES = JSON.parse(readFileSync(new URL('./layout-defects-routes.json',import.meta.url),'utf8'))

export const DEFECT_ROUTES = { ...ROUTES, tags: '/tags', affiliates: '/affiliates', 'inflow-links': '/inflow-links', conversions: '/conversions', ...Object.fromEntries(GAP_ROUTES.map(route=>[route,route])) }
export const keyOf = f => JSON.stringify([f.kind, f.target, f.other || '', f.text])
const KINDS = ['form-keyword-input', 'form-action-value', 'form-preview-surface', 'form-create-title', 'form-save-icon', 'form-help', 'form-copy', 'form-shrink', 'form-color', 'form-footer-action', 'form-optional', 'form-row-end', 'control-overlap', 'control-blocked', 'liffshadow', 'liffradio', 'canvasbottom', 'kpiblank', 'kpialign', 'kpimenu', 'cardspill', 'cardbottom', 'segempty', 'segselected', 'segstyle', 'choice-radio', 'choice-color', 'pageredge', 'rowmenu', 'bandtouch', 'customer-edit', 'insertoutside', 'insertlegacy', 'internal-window-copy', 'wrap', 'squash', 'clip', 'overlap', 'touch', 'blank', 'blank-vertical', 'blank-horizontal', 'blank-kpi', 'empty-blank-ok', 'align', 'missing', 'short', 'tallrow', 'blue', 'tight', 'rowbg', 'dark', 'boxclip', 'footgap', 'edge', 'inset', 'greenname', 'shortname', 'requirement-conflict', 'field-error-missing', 'menu-group-order', 'menu-icon-missing', 'toolbar-count-position', 'toolbar-unnamed-menu']
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
export function assessAgainstBase(findings, baseFindings, route, width, allowances = []) {
  validateAllowances(allowances)
  // 非表示の旧テーマを消すとnth-of-typeだけが変わる。両方の実画面で
  // workspaceが一つである証拠がある場合だけ、同じ経路へ一対一で結ぶ。
  const available = [...baseFindings]
  const restoreTarget = ({ measuredTarget, ...f }) => measuredTarget ? { ...f, target: measuredTarget } : f
  findings = findings.map(f => {
    if (!f.targetIdentity) return f
    const index = available.findIndex(base => base.targetIdentity === f.targetIdentity && base.kind === f.kind && base.text === f.text && (base.other || '') === (f.other || ''))
    if (index < 0) return f
    const [base] = available.splice(index, 1)
    return { ...f, target: base.target, measuredTarget: f.target }
  })
  // 固定の許可の上限を変えない。同じ項目の件数を二重に足すこともない。
  const fixedKeys = new Set(allowances.filter(a => a.route === route && a.width === width).map(keyOf))
  const baseline = record(baseFindings.filter(f => !['requirement-conflict', 'field-error-missing', 'menu-group-order', 'menu-icon-missing', 'toolbar-count-position', 'toolbar-unnamed-menu', 'form-required-badge', 'form-action-reason'].includes(f.kind)), route, width, '統合先で同じ検出器が確認した既存箇所')
    .filter(a => !fixedKeys.has(keyOf(a)))
  const baseKeys = new Set(baseline.map(keyOf))
  const result = assess(findings, route, width, [...allowances, ...baseline])
  return {
    failures: result.failures.map(restoreTarget),
    allowed: result.allowed.filter(f => !baseKeys.has(keyOf(f))).map(restoreTarget),
    existing: result.allowed.filter(f => baseKeys.has(keyOf(f))).map(restoreTarget),
    baseFindings,
  }
}
/** 番号を無視してよいのは、DOMで一つと確認した外枠だけ。子の番号は保つ。 */
export function identifyStableTargets(findings) {
  findings = findings.map(({ targetIdentity, ...f }) => f)
  const workspaces = [...document.querySelectorAll('[class]')].filter(el => [...el.classList].some(name => name === 'app-shell_workspace' || name.startsWith('app-shell_workspace__')))
  if (workspaces.length !== 1) return findings
  return findings.map(f => /div\.app-shell_workspace:nth-of-type\(\d+\)/.test(f.target)
    ? { ...f, targetIdentity: f.target.replace(/div\.app-shell_workspace:nth-of-type\(\d+\)/, 'div.app-shell_workspace:unique') }
    : f)
}
export async function measurePage(page) {
  const formColumns = formColumnFindings(await page.evaluate(collectFormLayouts))
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
  const consistency = await page.evaluate(scanCreateConsistency)
  const consistencyKinds = { Y1: 'form-action-value', Y2: 'form-preview-surface', Y3: 'form-create-title', Y4: 'form-save-icon' }
  const consistencyFindings = consistency.findings.map(f => ({ ...f, kind: consistencyKinds[f.kind] }))
  const findings = [...consistencyFindings, ...await page.evaluate(scanLayoutDefects), ...await page.evaluate(scanOwnerRules), ...await page.evaluate(scanPendec2Rules), ...panels, ...extra, ...await page.evaluate(scanControlOverlap), ...await page.evaluate(scanFormRules), ...await page.evaluate(scanB244Rules), ...formColumns]
  return await page.evaluate(identifyStableTargets, findings)
}
async function measureRoute(browser, baseUrl, route, width) {
  let page
  const errors = []
  try {
    page = await openPage(browser,{baseUrl,route,width,theme:'v8',stable:true,settleMs:0,onPageError:e=>errors.push(e.message),requireSuccess:true})
    await page.waitForSelector(route === '/login' ? 'form' : 'main')
    if (route !== '/login') await page.waitForFunction(() => document.querySelectorAll('main h1,main h2,main input,main [data-kpi-number]').length > 0)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready.then(() => true))
    if (new URL(page.url()).pathname !== new URL(route,baseUrl).pathname || errors.length || (await page.locator('body').innerText()).includes('画面を表示できませんでした')) throw new Error(errors.join('; ') || '指定画面を開けませんでした')
    return await measurePage(page)
  } finally { await page?.close() }
}
async function run() {
  const { chromium } = await import('@playwright/test')
  const args = process.argv.slice(2)
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : null
  const fixture = value('--fixture'), fixturesFile = value('--fixtures'), recordPath = value('--record-allow'), reason = value('--reason'), onlyRoute = value('--route'), compareUrl = value('--compare-url') || null
  if (recordPath && !reason?.trim()) throw new Error('採取には --reason が必要です')
  if (recordPath && process.env.CI) throw new Error('CI では許可リストを自動更新できません')
  const [baseUrl='http://127.0.0.1:4310',out] = args.filter((a,i) => !a.startsWith('--') && (i === 0 || !args[i-1].startsWith('--')))
  if (fixture && fixturesFile) throw new Error('対照は --fixture か --fixtures の一方だけです')
  if (compareUrl && (fixture || fixturesFile || recordPath)) throw new Error('統合先との比較は実画面の検査専用です')
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
      try {
        let findings
        if (fixtureCases) {
          page = await browser.newPage({viewport:{width,height:900}})
          await page.setContent(fixtureCases[route.slice('/fixture/'.length)])
          findings = await measurePage(page)
        } else {
          findings = await measureRoute(browser, baseUrl, route, width)
        }
        // 比べる相手を読めなければ測定失敗。空の基準として通してはいけない。
        const baseFindings = compareUrl ? await measureRoute(browser, compareUrl, route, width) : null
        recorded.push(...record(findings,route,width,reason || ''))
        const result = baseFindings ? assessAgainstBase(findings,baseFindings,route,width,allow) : assess(findings,route,width,allow)
        results[`${width} ${route}`] = result
        bad += result.failures.length
        console.log(`崩れ ${width} ${route}: 新規${result.failures.length}・許可${result.allowed.length}${baseFindings ? '・既存'+result.existing.length : ''}`)
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
