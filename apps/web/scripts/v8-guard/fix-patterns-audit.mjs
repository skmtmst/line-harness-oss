/** Reusable B-267 evidence; default routes are the shared list registry.
 * node fix-patterns-audit.mjs <base> <output.json> [cases.json]
 * Cases may supply {board,route,session,sessionStorage,api}; only reads are sent. */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import scanFixPatterns from './fix-patterns-browser.mjs'
import { sharedControlOwners } from './fix-pattern-owners.mjs'
import { scanListSkeleton } from './list-skeleton-scan.mjs'
import { measurePage, assess } from './layout-defects.mjs'
import { WIDTHS } from './browser-env.mjs'

const [base = 'http://127.0.0.1:4310', output = '/tmp/fix-patterns.json', casesPath] = process.argv.slice(2)
const registry = JSON.parse(readFileSync(new URL('../../design/list-skeleton.json', import.meta.url)))
const cases = casesPath ? JSON.parse(readFileSync(casesPath)) : [...new Set(registry.boards.map(b => b.url))].map(route => ({ route }))
const widths = process.env.FIX_PATTERN_WIDTHS?.split(',').map(Number) ?? WIDTHS
const session = { lh_csrf:'visual-qa-csrf',lh_staff_role:'owner',lh_staff_name:'K',lh_staff_permissions:'[]',lh_staff_view_permissions:'[]',lh_selected_account:'visual-qa-account',lh_auth_selection_cleared:'1' }
const results = [], browser = await chromium.launch()
let failed = false
mkdirSync(dirname(output), { recursive:true })
try {
  for (const entry of cases) for (const width of widths) {
    const context = await browser.newContext({ viewport:{ width,height:1128 }, reducedMotion:'reduce' })
    const page = await context.newPage(), errors = [], writes = []
    const result = { board:entry.board,route:entry.route,width }
    page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(({ local, temporary }) => {
      for (const [k,v] of Object.entries(local)) localStorage.setItem(k,v)
      for (const [k,v] of Object.entries(temporary)) sessionStorage.setItem(k,v)
    }, { local:{...session,...entry.session},temporary:entry.sessionStorage??{} })
    await page.route('**/*', async route => {
      const req = route.request(), key = `${req.method()} ${new URL(req.url()).pathname}`, headers = req.headers()
      if (headers['next-router-prefetch']==='1'||headers.purpose==='prefetch') return route.fulfill({status:204,body:''})
      if (!['GET','HEAD','OPTIONS'].includes(req.method()) && new URL(req.url()).pathname.startsWith('/api/')) {
        writes.push(key); return route.fulfill({status:405,body:'Read-only audit'})
      }
      const mock = entry.api?.find(rule => new RegExp(rule.match).test(key))
      if (mock) return route.fulfill({status:mock.status??200,contentType:'application/json',body:JSON.stringify(mock.body)})
      return route.continue()
    })
    try {
      const response = await page.goto(new URL(entry.route,base).href)
      if (!response?.ok()) throw Error(`HTTP ${response?.status()}`)
      await page.waitForLoadState('networkidle'); await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(2500)
      const patterns = await page.evaluate(scanFixPatterns,{cssOwners:sharedControlOwners()}), skeleton = await page.evaluate(scanListSkeleton)
      Object.assign(result,{...patterns,skeleton,layout:assess(await measurePage(page),entry.route,width,[])})
      result.overflow = await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
      failed ||= !!result.findings.length || !!result.layout.failures.length || !!result.overflow
    } catch (e) { result.error=e.message; failed=true }
    Object.assign(result,{errors,writes});failed ||= !!errors.length||!!writes.length
    results.push(result);writeFileSync(output,JSON.stringify(results,null,2)+'\n')
    console.log(entry.board??entry.route,width, result.error??`lists=${result.coverage.listPages} defects=${result.findings.length}`)
    await context.close()
  }
} finally { await browser.close() }
if (failed) process.exitCode=1
