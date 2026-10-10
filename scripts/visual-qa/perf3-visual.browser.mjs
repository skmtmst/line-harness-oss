/** PERF-01 baseline/after snapshots, real table geometry and accessible controls. */
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stubApi, installStressApi, waitForScreenReady } from '../../apps/web/scripts/v8-guard/speed-budget.mjs'
import { mockFetch } from '../../apps/web/scripts/v8-guard/mock-local.mjs'
const [base = 'http://127.0.0.1:4393', out = '/tmp/perf3-visual-before'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const results = []
try {
 for (const width of [1440,1152,1920]) for (const name of ['tags','friends']) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date('2026-10-01T05:00:00Z'))
  await page.addInitScript(() => {
   for (const [k,v] of Object.entries({ lh_csrf:'visual-qa-csrf',lh_selected_account:'visual-qa-account',lh_auth_selection_cleared:'1',lh_staff_role:'owner' })) localStorage.setItem(k,v)
  })
  const rowPrefetchRequests = []
  page.on('request', request => { if (name === 'tags' && /\/(?:tags\/edit|friends)\.txt\?/.test(request.url())) rowPrefetchRequests.push(request.url()) })
  await stubApi(page,mockFetch)
  if (name==='friends') await installStressApi(page,{stub:true,mockFetch})
  await page.goto(`${base}/${name}`,{waitUntil:'networkidle'})
  await waitForScreenReady(page,`/${name}`,name==='friends'?2000:null)
  await page.addStyleTag({ content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
  const geometry = await page.evaluate(() => {
   const main=document.querySelector('main'), table=main.querySelector('table'), body=table.tBodies[0]
   const boxes=[...body.querySelectorAll('tr:not([aria-hidden="true"])')].map(r=>({id:r.dataset.rowId,height:r.getBoundingClientRect().height,cells:[...r.cells].map(c=>({x:c.getBoundingClientRect().x,width:c.getBoundingClientRect().width,text:c.textContent}))}))
   return { pageX:document.documentElement.scrollWidth>document.documentElement.clientWidth,tableX:table.scrollWidth>table.clientWidth+1,bodyHeight:body.getBoundingClientRect().height,boxes }
  })
  assert.equal(geometry.pageX,false); assert.equal(geometry.tableX,false)
  await page.screenshot({path:join(out,`${width}-${name}.png`)})
  if (process.env.VERIFY_PREFETCH === '1' && name === 'tags') assert.equal(rowPrefetchRequests.length, 0, '一覧の行が遷移先を自動先読みしている')
  results.push({width,name,rowPrefetchRequests,...geometry})
  await page.close()
 }
} catch (error) {
 console.error(error)
 process.exitCode = 1
} finally {await browser.close();writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2))}
