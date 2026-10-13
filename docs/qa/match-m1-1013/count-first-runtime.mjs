import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
const root='/Users/kentakenta/lh-work/lh-pages-matchm', out=new URL('.',import.meta.url).pathname
const require=createRequire(root+'/package.json'),{chromium}=require('@playwright/test')
const {default:scanPatterns}=await import(root+'/apps/web/scripts/v8-guard/fix-patterns-browser.mjs')
const {sharedControlOwners}=await import(root+'/apps/web/scripts/v8-guard/fix-pattern-owners.mjs')
const {scanListSkeleton}=await import(root+'/apps/web/scripts/v8-guard/list-skeleton-scan.mjs')
const {measurePage,assess}=await import(root+'/apps/web/scripts/v8-guard/layout-defects.mjs')
const {countFixPatterns}=await import(root+'/apps/web/scripts/v8-guard/fix-pattern-counts.mjs')
const {default:scanLayout}=await import(root+'/apps/web/scripts/v8-guard/layout-defects-browser.mjs')
const {default:scanOwner}=await import(root+'/apps/web/scripts/v8-guard/owner-rules-browser.mjs')
const {default:scanForm}=await import(root+'/apps/web/scripts/v8-guard/form-rules-browser.mjs')
const {default:scanPanel}=await import(root+'/apps/web/scripts/v8-guard/panel-blank-browser.mjs')
const {default:scanPendec}=await import(root+'/apps/web/scripts/v8-guard/pendec2-rules-browser.mjs')
const {scanShapes}=await import('./shape.mjs')
const {scanAdditionalControls}=await import('./controls.mjs')
const cases=JSON.parse(readFileSync(out+'cases.json')), keys=Array.from({length:10},(_,i)=>'F'+(i+1))
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
const filter=process.argv[2]?.split(','), name=process.argv[3]==='smoke'?'first':process.argv[3]??'first'
const jobs=process.argv[3]==='smoke'?[...cases.filter(c=>filter.includes(c.board)),...cases.filter(c=>!filter.includes(c.board))]:cases.filter(c=>!filter||filter.includes(c.board))
const base='http://127.0.0.1:4357'
const fresh=execFileSync('zsh',['/Users/kentakenta/lh-work/tools/hq/fresh-check.sh',root,base],{cwd:root,encoding:'utf8'});writeFileSync(out+name+'-fresh-check.txt',fresh);console.log(fresh.trim())
const results=[], browser=await chromium.launch()
const scopeFunction=fn=>'('+fn.toString().replaceAll("document.querySelector('main') || document.body","document.querySelector('[data-m1-scope]') || document.querySelector('main') || document.body").replace('const root = document.body','const root = document.querySelector(\'[data-m1-scope]\') || document.body')+')()'
let patched=scanPatterns.toString().replace("[role=\"dialog\"],[role=\"menu\"],[role=\"listbox\"],",'').replace("const roots = [...document.querySelectorAll('[data-page-template]')].filter(visible)","const roots = [...document.querySelectorAll('[data-m1-scope]')].filter(visible)")
const session={lh_csrf:'visual-qa-csrf',lh_staff_role:'owner',lh_staff_name:'K',lh_staff_permissions:'[]',lh_staff_view_permissions:'[]',lh_selected_account:'visual-qa-account',lh_auth_selection_cleared:'1'}
const safe=x=>String(x??'—').replace(/[\t\r\n]/g,' ')
function flush(){
 writeFileSync(out+name+'-results.json',JSON.stringify(results,null,2)+'\n')
 writeFileSync(out+name+'-counts.tsv', [['board','group','name','route','width','reached','measured','scope',...keys,'layout','overflow','reason','sha','time'],...results.map(r=>[r.board,r.group,r.name,r.route,r.width,r.reached,r.measured,r.scope,...keys.map(k=>r.measured?r.counts?.[k]:null),r.measured?r.layout?.failures.length:null,r.measured?r.overflow:null,r.error,sha,r.time])].map(row=>row.map(safe).join('\t')).join('\n')+'\n')
}
async function click(page,step){
 if(step.startsWith('when-present:')){const l=page.getByRole('button',{name:step.slice(13),exact:true});if(await l.isVisible())await l.click();return}
 if(step.startsWith('press:'))return page.keyboard.press(step.slice(6))
 if(step.startsWith('fill:')){const b=step.slice(5),i=b.indexOf('=');const n=b.slice(0,i),v=b.slice(i+1);let l=page.getByLabel(n,{exact:true}).first();if(!await l.count())l=page.getByRole('textbox',{name:n}).first();if(!await l.count())l=page.getByPlaceholder(n).first();await l.fill(v);return}
 if(step.startsWith('check:')){await page.getByRole('checkbox',{name:step.slice(6),exact:true}).first().check();return}
 if(step.startsWith('css:')){await page.locator(step.slice(4)).first().click();return}
 if(step==='event:focus'){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));return}
 if(step==='api:later')throw Error('later state not staged')
 let l=page.getByRole('menuitem',{name:step,exact:true}).first();if(!await l.count())l=page.getByRole('button',{name:step,exact:true}).first();if(!await l.count())l=page.getByRole('link',{name:step,exact:true}).first();if(!await l.count())l=page.getByRole('button',{name:step}).first();if(!await l.count())l=page.getByRole('link',{name:step}).first();if(!await l.count())l=page.getByText(step).first();await l.click()
}
mkdirSync(out+'images',{recursive:true});mkdirSync(out+'inspect',{recursive:true})
async function worker(){
 while(jobs.length){const entry=jobs.shift(); for(const width of [1440,1152,1920]){
 const context=await browser.newContext({viewport:{width,height:1128},reducedMotion:'reduce',timezoneId:'Asia/Tokyo'}),page=await context.newPage();page.setDefaultTimeout(4000)
 const r={...entry,width,time:new Date().toISOString(),sha,errors:[],writes:[],reached:false,measured:false,actions:[]}
 page.on('pageerror',e=>r.errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-01T05:00:00Z'))
 await context.addInitScript(({local,temporary})=>{for(const[k,v]of Object.entries(local))localStorage.setItem(k,v);for(const[k,v]of Object.entries(temporary))sessionStorage.setItem(k,v)},{local:{...session,...entry.state.localStorage},temporary:entry.state.sessionStorage??{}})
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),key=req.method()+' '+u.pathname,h=req.headers();if(h['next-router-prefetch']==='1'||h.purpose==='prefetch')return route.fulfill({status:204,body:''});if(!['GET','HEAD','OPTIONS'].includes(req.method()) && (/\/api\//.test(u.pathname)||u.origin!==base)){r.writes.push(key);return route.fulfill({status:405,contentType:'application/json',body:'{"success":false,"error":"Read-only audit"}'})}const rule=(entry.state.api??[]).find(a=>new RegExp(a.match).test(key));if(rule)return route.fulfill({status:rule.status??200,contentType:'application/json',body:JSON.stringify(rule.body).replaceAll('@TODAY@','2026-10-01')});if(u.origin!==base&&u.origin!=='http://127.0.0.1:8857'&&!/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname))return route.abort();return route.continue()})
 try{
  const response=await page.goto(base+entry.route,{waitUntil:'networkidle',timeout:20000});r.http=response.status();if(!response.ok()&&entry.board!=='Nx5dz')throw Error('HTTP '+response.status())
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700)
  r.theme=await page.evaluate(()=>document.documentElement.dataset.theme)
  if(r.theme!=='v8')throw Error('V8の表示ではない')
  r.parentOpened=new URL(page.url()).pathname===new URL(entry.route,base).pathname
  if(!r.parentOpened)throw Error('別画面へ移動: '+new URL(page.url()).pathname)
  if(entry.blocked)throw Error(entry.blocked)
  for(const step of entry.clicks){await click(page,step);r.actions.push(step);await page.waitForTimeout(250)}
  await page.waitForTimeout(550)
  const data=await page.evaluate(()=>{const visible=el=>el.getBoundingClientRect().width>1&&el.getBoundingClientRect().height>1&&getComputedStyle(el).visibility!=='hidden';const overlays=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"]')].filter(visible);return {text:document.querySelector('main')?.innerText??document.body.innerText,overlays:overlays.map(el=>({role:el.getAttribute('role'),title:el.getAttribute('aria-label')??el.querySelector('h2,h3')?.textContent,text:el.innerText,rect:el.getBoundingClientRect().toJSON()})),templates:[...document.querySelectorAll('[data-page-template]')].filter(visible).map(el=>el.dataset.pageTemplate),controls:[...document.querySelectorAll('button,a,input,select')].filter(visible).map(el=>({tag:el.tagName,text:el.innerText,name:el.getAttribute('aria-label'),label:el.labels?.[0]?.innerText,placeholder:el.getAttribute('placeholder')}))}})
  r.stateEvidence=data;r.finalUrl=page.url()
  if(r.writes.length)throw Error('状態が要る：指定状態への更新要求を読み取り検査で遮断 ('+r.writes.join(', ')+')')
  if(data.text.includes('画面を表示できませんでした'))throw Error('画面表示失敗')
  if(entry.manual&&!entry.resolved)throw Error('指定状態未到達: '+entry.manual)
  if(entry.requireOverlay&&!data.overlays.length)throw Error('指定の窓・メニューが開いていない')
  if(entry.expectedText&&!data.text.includes(entry.expectedText)&&!data.overlays.some(x=>x.text.includes(entry.expectedText)))throw Error('指定状態の文字がない: '+entry.expectedText)
  r.reached=true
  const overlay=await page.locator('[role="dialog"]:visible,[role="alertdialog"]:visible,[role="menu"]:visible').last().count()
  r.scope=entry.scopeSelector?'panel':overlay?'overlay':'page'
  let patterns,skeleton,layout
  if(overlay||entry.scopeSelector){await page.locator(entry.scopeSelector??'[role="dialog"]:visible,[role="alertdialog"]:visible,[role="menu"]:visible').last().evaluate(el=>el.setAttribute('data-m1-scope',''))
   patterns=await page.evaluate('('+patched+')('+JSON.stringify({cssOwners:sharedControlOwners()})+')');skeleton={failures:[]}
   const findings=[];for(const fn of [scanLayout,scanOwner,scanForm,scanPanel,scanPendec])findings.push(...await page.evaluate(scopeFunction(fn)))
   layout=assess(findings,entry.route,width,[])
  }else{patterns=await page.evaluate(scanPatterns,{cssOwners:sharedControlOwners()});skeleton=await page.evaluate(scanListSkeleton);layout=assess(await measurePage(page),entry.route,width,[])}
  const counted=countFixPatterns(patterns,skeleton,layout)
  const shape=await page.evaluate(scanShapes);if(shape.covered){counted.counts.F10=(counted.counts.F10??0)+shape.findings.length;counted.findings.push(...shape.findings)};r.shape=shape
  const controls=await page.evaluate(scanAdditionalControls);counted.counts.F8+=controls.findings.length;counted.findings.push(...controls.findings);r.disabledControls=controls
  for(const f of counted.findings){if(f.kind==='form-shrink'){counted.counts.F6--;counted.counts.F10=(counted.counts.F10??0)+1;f.pattern='F10'}}
  Object.assign(r,{...counted,layout,coverage:patterns.coverage,inventory:patterns.inventory,skeleton,overflow:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),version:await(await page.request.get(base+'/version.json')).json(),measured:patterns.coverage.pages>0})
  if(!r.measured)r.error='型の測定範囲がない（崩れ検査のみ）'
 }catch(e){r.error=e.message}
 try{r.visible=await page.locator('body').innerText({timeout:1500});r.controls=await page.evaluate(()=>[...document.querySelectorAll('button,a,input,select')].filter(el=>el.getBoundingClientRect().width>1).map(el=>({text:el.innerText,name:el.getAttribute('aria-label'),placeholder:el.getAttribute('placeholder'),tag:el.tagName})));r.screenshot=out+'images/'+name+'-'+entry.board+'-'+width+'.png';await page.screenshot({path:r.screenshot,fullPage:true,animations:'disabled',timeout:10000})}catch(e){r.screenshotError=e.message}
 results.push(r);flush();console.log(entry.board,width,r.measured?JSON.stringify(r.counts):r.error);await context.close()
 }}
}
try{
 const probe=await browser.newPage({viewport:{width:1152,height:900}})
 await probe.setContent('<div data-m1-scope role="dialog" style="width:480px"><button disabled aria-describedby="reason">保存する</button><p id="reason">名前を入れてください</p></div>')
 const explained=await probe.evaluate(scanAdditionalControls),normal=await probe.evaluate(scanShapes)
 await probe.locator('#reason').evaluate(el=>el.hidden=true)
 const hidden=await probe.evaluate(scanAdditionalControls)
 await probe.locator('[data-m1-scope]').evaluate(el=>el.style.width='2000px')
 const wide=await probe.evaluate(scanShapes)
 const control={explained:explained.findings.length,normal:normal.findings.length,hiddenReason:hidden.findings.length,tooWide:wide.findings.length}
 writeFileSync(out+name+'-detector-control.json',JSON.stringify(control,null,2)+'\n')
 if(control.explained!==0||control.normal!==0||control.hiddenReason!==1||control.tooWide<1)throw Error('測定用の対照が不成立')
 await probe.close()
 await Promise.all([worker(),worker()])
}finally{await browser.close()}
writeFileSync(out+name+'-end.json',JSON.stringify({sha,time:new Date().toISOString(),rows:results.length},null,2)+'\n')
