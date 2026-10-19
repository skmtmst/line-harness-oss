/** Reusable  evidence; default routes are the shared list registry.
 * node fix-patterns-audit.mjs <base> <output.json> [cases.json]
 * Cases may supply {board,route,session,sessionStorage,api}; only reads are sent. */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run as sourceAudit, codeFindings } from '../../../../scripts/visual-qa/v8-pattern-audit.mjs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import scanFixPatterns from './fix-patterns-browser.mjs'
import { sharedControlOwners } from './fix-pattern-owners.mjs'
import { scanListSkeleton } from './list-skeleton-scan.mjs'
import { measurePage, assess } from './layout-defects.mjs'
import { countFixPatterns, countTable, sourceCountTable } from './fix-pattern-counts.mjs'
import { screenReady } from './screen-ready.mjs'
import { WIDTHS } from './browser-env.mjs'
import scanTableColumnAlignment from './table-column-alignment-browser.mjs'
import scanVisualState from './visual-state-browser.mjs'

const [base = 'http://127.0.0.1:4310', output = '/tmp/fix-patterns.json', casesPath] = process.argv.slice(2)
const registry = JSON.parse(readFileSync(new URL('../../design/list-skeleton.json', import.meta.url)))
const cases = casesPath ? JSON.parse(readFileSync(casesPath)) : [...new Set(registry.boards.map(b => b.url))].map(route => ({ route }))
if (!Array.isArray(cases) || !cases.length) throw Error('Nonempty case array required')
const widths = process.env.FIX_PATTERN_WIDTHS?.split(',').map(Number) ?? WIDTHS
const session = { lh_csrf:'visual-qa-csrf',lh_staff_role:'owner',lh_staff_name:'K',lh_staff_permissions:'[]',lh_staff_view_permissions:'[]',lh_selected_account:'visual-qa-account',lh_auth_selection_cleared:'1' }
const tableOutput = output.replace(/\.json$/, '') + '.tsv'
const presenceOutput = output.replace(/\.json$/, '') + '-presence.json'
const sourceReport = sourceAudit({code:resolve(fileURLToPath(new URL('../../../../',import.meta.url)))})
const sourceHits = codeFindings(sourceReport)
const codeRoot = sourceReport.meta.code
sourceReport.meta.sha = execFileSync('git',['rev-parse','HEAD'],{cwd:codeRoot,encoding:'utf8'}).trim()
sourceReport.meta.dirty = Boolean(execFileSync('git',['status','--porcelain'],{cwd:codeRoot,encoding:'utf8'}).trim())
function dependencies(sources) {
  const found = new Set()
  const visit = file => {
    if (found.has(file) || !existsSync(resolve(codeRoot,file))) return
    found.add(file)
    if (!/\.[cm]?[jt]sx?$/.test(file)) return
    const imported = ts.preProcessFile(readFileSync(resolve(codeRoot,file),'utf8'),true,true).importedFiles
    for (const {fileName: name} of imported) {
      const prefix = name.startsWith('@/') ? 'apps/web/src/'+name.slice(2) : name.startsWith('.') ? join(dirname(file),name) : null
      if (!prefix) continue
      const dependency = [prefix,prefix+'.tsx',prefix+'.ts',join(prefix,'index.tsx'),join(prefix,'index.ts')].find(path=>existsSync(resolve(codeRoot,path)) && /\.(tsx?|css)$/.test(path))
      if (dependency) visit(dependency)
    }
  }
  sources.forEach(visit)
  return [...found]
}
for (const entry of cases) {
  const pathname = new URL(entry.route,'http://local.test').pathname
  const known = registry.boards.filter(row=>new URL(row.url,'http://local.test').pathname===pathname)
  const sources = entry.sources ?? known.map(row=>'apps/web/src/'+row.source)
  if (!sources.length) sources.push(join('apps/web/src/app',pathname,'page.tsx'))
  entry.sourceFiles = dependencies(sources)
}
const results = [], browser = await chromium.launch()
let failed = false
mkdirSync(dirname(output), { recursive:true })
writeFileSync(output.replace(/\.json$/, '')+'-source.json',JSON.stringify({meta:sourceReport.meta,code:sourceReport.code},null,2)+'\n')
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
      if (new URL(page.url()).pathname !== new URL(entry.route,base).pathname) throw Error('Unexpected route')
      await page.waitForLoadState('networkidle')
      await page.waitForFunction(screenReady,{route:new URL(entry.route,base).pathname})
      const ready = await page.evaluate(screenReady,{route:new URL(entry.route,base).pathname})
      if (ready !== true) throw Error('Screen did not load successfully')
      await page.evaluate(()=>document.fonts.ready)
      await page.waitForLoadState('networkidle')
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      const versionResponse = await page.request.get(new URL('/version.json',base).href)
      if (!versionResponse.ok()) throw Error('Missing version.json')
      result.version = await versionResponse.json()
      if (process.env.FIX_PATTERN_EXPECT_SHA && result.version.git_commit !== process.env.FIX_PATTERN_EXPECT_SHA) throw Error('Capture SHA mismatch')
      const patterns = await page.evaluate(scanFixPatterns,{cssOwners:sharedControlOwners()}), skeleton = await page.evaluate(scanListSkeleton)
      if (!patterns.coverage.pages) throw Error('No page template; coverage is missing, not zero defects')
      const layout = assess(await measurePage(page),entry.route,width,[])
      Object.assign(result,{...patterns,...countFixPatterns(patterns,skeleton,layout),skeleton,layout})
      result.columnAlignment = await page.evaluate(scanTableColumnAlignment)
      result.visualState = await page.evaluate(scanVisualState, { expectedState: entry.expectedState ?? null })
      if (process.env.FIX_PATTERN_SCREENSHOTS === '1') {
        const imageDir = join(dirname(output),basename(output,'.json')+'-images'); mkdirSync(imageDir,{recursive:true})
        result.screenshot = join(imageDir,`${entry.board ?? String(cases.indexOf(entry))}-${width}.png`)
        await page.screenshot({path:result.screenshot,fullPage:true,animations:'disabled'})
      }
      result.overflow = await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
      failed ||= !!result.findings.length || !!result.layout.failures.length || !!result.overflow || !!result.columnAlignment.findings.length || !!result.visualState.findings.length
    } catch (e) { result.error=e.message; result.visibleText=await page.locator('main').innerText().catch(()=>null); failed=true }
    result.sourceCandidates = entry.sourceFiles.length ? sourceHits.filter(hit=>entry.sourceFiles.includes(hit.file)) : null
    result.sourceCoverage = {sha:sourceReport.meta.sha,dirty:sourceReport.meta.dirty,files:entry.sourceFiles, candidates:result.sourceCandidates?.length??null}
    Object.assign(result,{errors,writes});failed ||= !!errors.length||!!writes.length
    results.push(result);writeFileSync(output,JSON.stringify(results,null,2)+'\n')
    writeFileSync(tableOutput,countTable(results));writeFileSync(output.replace(/\.json$/, '')+'-source.tsv',sourceCountTable(results));writeFileSync(presenceOutput,JSON.stringify(results.map(r=>({board:r.board,route:r.route,width:r.width,error:r.error,inventory:r.inventory})),null,2)+'\n')
    console.log(entry.board??entry.route,width, result.error??`lists=${result.coverage.listPages} defects=${result.findings.length}`)
    await context.close()
  }
} finally { await browser.close() }
if (failed) process.exitCode=1
