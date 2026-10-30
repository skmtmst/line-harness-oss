import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectGuardBrowser } from './browser-session.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { AUTOMATION_RUNS } from '../../../../scripts/visual-qa/fixtures.mjs'
import { detailSurfaceCases } from './detail-surface-cases.mjs'
import scanDetailSurfaces from './detail-surface-browser.mjs'

const root = process.env.V8_GUARD_DETAIL_OUT ? resolve(process.env.V8_GUARD_DETAIL_OUT) : fileURLToPath(new URL('../../out/', import.meta.url))
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
async function fixture(method, path, screen) {
  if (method === 'OPTIONS') return {status: 204, body: ''}
  if (!['GET','HEAD'].includes(method)) throw new Error(`詳細の見張りで書き込みはしない: ${method} ${path}`)
  const answer = await mockFetch(method,path)
  if (!answer.body?.trim().startsWith('{')) return answer
  const data = JSON.parse(answer.body)
  const pathname = path.split('?')[0]
  if (['/api/staff/me','/api/auth/session'].includes(pathname)) data.data = {...data.data,id:'detail-owner',name:'画面確認のオーナー',tenantId:'visual-tenant-1',role:'owner',readOnly:false,accountScope:'all',impersonation:null,permissionKeys:[],permissionViewKeys:[],viewPermissionKeys:[]}
  if (/^\/api\/automation-runs\/run-[0-9]+$/.test(pathname)) {
    const row = AUTOMATION_RUNS.items.find(row => row.id === pathname.split('/').pop()) ?? AUTOMATION_RUNS.items[0]
    data.data = {...row,friendId:'friend-1',friendName:row.subject,automationVersionId:'fixture-version',isTest:row.isTest??false,canCancel:row.canCancel??false,holdReason:null,isCurrentVersion:true,currentVersionNumber:row.versionNumber,steps:[]}
  }
  if (pathname === '/api/dashboard/style' && ['ec-orders','identity-candidates'].includes(screen)) data.data = {...data.data,style:'ec',styleSelected:true}
  if (pathname === '/api/booking/admin/entitlements') data.data = [{id:'detail-ticket',line_account_id:'visual-qa-account',friend_id:'friend-1',menu_id:null,kind:'ticket',name:'見本の回数券',remaining:3,monthly_limit:null,valid_from:'2026-10-01T00:00:00+09:00',expires_at:'2026-12-31T23:59:59+09:00',status:'active',version:1,created_at:'2026-10-01T00:00:00+09:00',updated_at:'2026-10-01T00:00:00+09:00',monthUsed:0,monthAllowance:null,monthRemaining:null,periodStart:'2026-10-01',periodEnd:'2026-10-31'}]
  if (pathname === '/api/booking/admin/entitlements/detail-ticket/history') data.data = []
  return {...answer,body:JSON.stringify(data)}
}

for (const width of [1152,1440]) test(`実際の27種類と埋め込み6の右の面を測る ${width}`, async () => {
  assert.ok(existsSync(join(root,'version.json')), 'AIと飲食店の検査用フラグを有効にした本番形式buildが必要')
  const server = createServer((req,res) => {
    const path = resolve(root, `.${new URL(req.url,'http://localhost').pathname}`)
    const file = [path,`${path}.html`,join(path,'index.html')].find(file => file.startsWith(root) && existsSync(file) && statSync(file).isFile())
    if (!file) {res.writeHead(404);res.end();return}
    res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'});res.end(readFileSync(file))
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const browser = await connectGuardBrowser()
  try {
    for (const item of detailSurfaceCases) {
      const page = await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce'})
      try {
        await stubApi(page,(method,path)=>fixture(method,path,item.key))
        await page.addInitScript(init => {
          for (const [key,value] of Object.entries(init)) localStorage.setItem(key,value)
          const original = window.fetch.bind(window);window.__detailPending=0
          window.fetch=async(...args)=>{window.__detailPending++;try{return await original(...args)}finally{window.__detailPending--}}
        },PARITY_INIT)
        assert.ok((await page.goto(base+item.path))?.ok(),item.key)
        const ready = async () => { await page.waitForFunction(()=>window.__detailPending===0 && document.fonts.status==='loaded' && document.querySelector('main')) }
        await ready()
        for (const action of item.actions??[]) {await (typeof action === 'string' ? page.locator(action) : page.getByRole(action.role,{name:action.name,exact:true})).click();await ready()}
        const selector = item.selector??'[data-design-part="detail-panel"],[data-design-part="drawer"]'
        const panel=page.locator(selector).first();await panel.waitFor({state:'attached'})
        await ready()
        const toggle = await panel.evaluate(el => el.getBoundingClientRect().width===0 ? [...document.querySelectorAll('button[aria-controls]')].find(button => button.getAttribute('aria-controls')===el.id)?.getAttribute('aria-controls') : null)
        if (toggle) await page.locator(`button[aria-controls="${toggle}"]`).click()
        await panel.waitFor({state:'visible'})
        await page.waitForFunction(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running'))
        assert.equal(await page.evaluate(()=>localStorage.getItem('lh_staff_role')),'owner',item.key)
        assert.deepEqual(await page.evaluate(scanDetailSurfaces),[],`${item.key} ${width}`)
        if (item.key==='staff-calendar') {
          await panel.getByRole('textbox',{name:'固定の会議の URL'}).fill('https://meet.example.invalid/changed')
          await panel.getByRole('button',{name:'保存する',exact:true}).waitFor()
          assert.deepEqual(await page.evaluate(scanDetailSurfaces),[],`URL変更中 ${width}`)
        }
        const footer=panel.locator(':scope > footer,[data-detail-preview] > footer').first()
        if (await footer.count()) {
          const actions=await footer.locator('[data-detail-actions]').elementHandle()
          await actions.evaluate(el=>el.removeAttribute('data-detail-actions'))
          assert.ok((await page.evaluate(scanDetailSurfaces)).some(error=>error.kind==='detail-footer'),`${item.key} 自由な帯へ戻す故障`)
          await actions.evaluate(el=>el.setAttribute('data-detail-actions',''))
          assert.deepEqual(await page.evaluate(scanDetailSurfaces),[],`${item.key} 帯の復元`)
        }
        const body=await panel.locator('[data-detail-content]').first().elementHandle()
        const injected=await body.evaluateHandle(el=>{const button=document.createElement('button');button.dataset.sharedButton='';button.dataset.variant='primary';button.textContent='本文の主操作';el.append(button);return button})
        assert.ok((await page.evaluate(scanDetailSurfaces)).some(error=>error.kind==='detail-body-action'),`${item.key} 本文の主操作の故障`)
        await injected.evaluate(el=>el.remove());assert.deepEqual(await page.evaluate(scanDetailSurfaces),[],`${item.key} 主操作の復元`)
        const saved=await body.getAttribute('data-detail-content')
        await body.evaluate(el=>el.removeAttribute('data-detail-content'))
        assert.ok((await page.evaluate(scanDetailSurfaces)).some(error=>error.kind==='detail-content'),`${item.key} 共通の本文を外す故障`)
        await body.evaluate((el,value)=>el.setAttribute('data-detail-content',value??''),saved)
        assert.deepEqual(await page.evaluate(scanDetailSurfaces),[],`${item.key} 復元`)
        console.log(`detail surface ${item.key} ${width}: healthy / missing body rejected / restored`)
      } catch (error) {
        const dir=fileURLToPath(new URL('../../test-results/detail-surfaces/',import.meta.url));mkdirSync(dir,{recursive:true})
        await page.screenshot({path:join(dir,`${width}-${item.key}.png`)}).catch(()=>{})
        writeFileSync(join(dir,`${width}-${item.key}.json`),JSON.stringify({url:page.url(),error:String(error),text:await page.locator('body').innerText().catch(()=>null)},null,2))
        throw error
      } finally {await page.close()}
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve))}
})
