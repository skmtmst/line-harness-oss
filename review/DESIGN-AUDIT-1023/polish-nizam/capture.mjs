const fs = await import('node:fs/promises');
const {measureControlCentering}=await import('/Users/kentakenta/lh-work/lh-polish-1023/scripts/visual-qa/control-centering.mjs');
const task=await taskSpace(18),p=task.page('p1');
const out='/Users/kentakenta/lh-work/lh-polish-1023/review/DESIGN-AUDIT-1023/polish-nizam';
const phase='after', widths=[1440,1152,1920];
await fs.mkdir(`${out}/${phase}`,{recursive:true});
const results=[];
const buildId=(await fs.readFile('/Users/kentakenta/lh-work/lh-polish-1023/apps/web/out/templates.html','utf8')).match(/<!--(.*?)-->/)[1];
async function go(route,width,selector){
 await p.cdp('Network.enable',{});
 await p.cdp('Network.setCacheDisabled',{cacheDisabled:true});
 await p.goto('http://localhost:3184'+route);
 await p.reload();
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
 await p.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await p.waitForFunction(selector => selector.startsWith('loc=') ? [...document.querySelectorAll('button')].some(e=>e.textContent==='表示を変える') : !!document.querySelector(selector),selector,{timeout:30000});
 await p.evaluate(()=>document.fonts.ready);
 await p.waitForFunction(buildId => [...document.childNodes].some(n=>n.nodeType===8&&n.nodeValue===buildId)&&getComputedStyle(document.documentElement).getPropertyValue('--polish-window-cancel-bg').trim()==='#f1f1f2',buildId,{timeout:30000});
}
async function shot(name,route,width,kind){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
 await p.waitForFunction(()=>[...document.getAnimations()].every(a=>a.playState!=='running'),undefined,{timeout:10000});
 const geometry=await p.evaluate(({kind})=>{
  const visible=el=>!!el.getBoundingClientRect().width&&!!el.getBoundingClientRect().height;
  const panels=[...document.querySelectorAll('[aria-modal="true"]')].filter(visible);
  const panel=panels.at(-1);const r=panel?.getBoundingClientRect();
  const controls=panel?[...panel.querySelectorAll('button')].filter(visible).filter(el=>!el.closest('[class*="body"],[class*="content"]')):[];
  const hidden=controls.filter(el=>{const b=el.getBoundingClientRect();return b.left<r.left-.5||b.right>r.right+.5||b.top<r.top-.5||b.bottom>r.bottom+.5});
  const steps=[...document.querySelectorAll('[data-part="steps"]')].filter(visible).map(nav=>({overflow:nav.scrollWidth-nav.clientWidth,positions:[...nav.querySelectorAll('[data-step-dot]')].map((dot,i)=>{const d=dot.getBoundingClientRect(),n=nav.querySelectorAll('[data-step-name]')[i].getBoundingClientRect();return {below:n.top>=d.bottom,offset:Math.abs(n.left+n.width/2-d.left-d.width/2)}})}));
  return {buildId:[...document.childNodes].find(n=>n.nodeType===8)?.nodeValue,url:location.pathname+location.search,width:innerWidth,pageOverflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,panel:panel?{title:panel.querySelector('h2')?.textContent,rect:r.toJSON(),overflow:panel.scrollWidth-panel.clientWidth,bounds:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hidden: hidden.map(e=>e.textContent),radius:getComputedStyle(panel).borderTopLeftRadius}:null,steps};
 },{kind});
 const controls=kind==='list'?await p.evaluate(measureControlCentering):null;
 if(kind==='list' && controls.measured.length===0)throw new Error(`${name}: 選択入力が未到達`);
 if(geometry.url.replace(/\/$/,'')!==route.replace(/\/$/,''))throw new Error(`${name}: 違うURL ${geometry.url}`);
 await p.screenshot({path:`${out}/${phase}/${name}-${width}.png`});
 results.push({name,route,kind,...geometry,controls});
 await fs.writeFile(`${out}/${phase}/measurements.json`,JSON.stringify(results,null,2));
 console.log({name,width,overflow:geometry.pageOverflow,panel:geometry.panel?.title,centering:controls?.findings.length});
}
for(const width of widths){
 await p.evaluate(()=>localStorage.setItem('lh-sidebar-collapsed','1'));
 await go('/templates',width,'input[type=checkbox]');
 await p.click('label:has(input[aria-label="「初回お問い合わせへの返信」を選択"])');
 await shot('list-templates','/templates',width,'list');
 await p.evaluate(()=>localStorage.setItem('lh-sidebar-collapsed','0'));
 await go('/friends',width,'input[type=checkbox]');
 await p.click('label:has(input[aria-label="Kyohei Yamamotoを選ぶ"])');
 await shot('list-friends','/friends',width,'list');
 await go('/templates',width,'input[type=checkbox]');
 // フォルダ列が畳まれる幅では、作成を同じURLで広げて開いたあと指定幅に戻す。
 if(width<1440)await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await p.click('loc=role:button[name="フォルダを追加"]');
 await p.waitForSelector('[role=dialog]');
 await shot('dialog-create','/templates',width,'dialog');
 await go('/broadcasts',width,'input[type=checkbox]');
 await p.click('button[aria-label="配信「未購入者フォロー」の操作"]');
 await p.click('loc=role:menuitem[name="削除する"]');
 await p.waitForSelector('[role=alertdialog]');
 await shot('dialog-confirm','/broadcasts',width,'dialog');
 await go('/',width,'loc=role:button[name="表示を変える"]');
 await p.click('loc=role:button[name="表示を変える"]');
 await p.waitForSelector('[role=dialog]');
 await shot('drawer','/?edit=1',width,'dialog');
 for(const [name,route]of [['steps-account','/accounts/new'],['steps-scenario','/scenarios/new']]){
  await go(route,width,'[data-part=steps]');await shot(name,route,width,'steps');
 }
}
console.log({phase,shots:results.length,findings:results.filter(r=>r.pageOverflow||r.panel&&(!r.panel.bounds||r.panel.overflow||r.panel.hidden.length)||r.controls?.findings.length||r.steps.some(s=>s.overflow||s.positions.some(p=>!p.below||p.offset>.5)))});

const controlResults=[];
for(const width of [1152,1440,1920]){
 for(const route of ['/friends','/broadcasts','/settings','/templates','/analytics/reports/new','/login','/ec-commerce?tab=auto-line']){
  await go(route,width,'input[type="checkbox"],button[role="switch"]');
  const measured=await p.evaluate(measureControlCentering);
  if(!measured.measured.length)throw new Error(`${route}: 選択入力が未到達`);
  const overflow=await p.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth);
  controlResults.push({route,width,overflow,...measured});
 }
}
await fs.writeFile(`${out}/${phase}/controls.json`,JSON.stringify(controlResults,null,2));
console.log({controlPages:controlResults.length,controls:controlResults.reduce((n,r)=>n+r.measured.length,0),controlFindings:controlResults.flatMap(r=>r.findings),overflows:controlResults.filter(r=>r.overflow)});

const badSurfaces=results.filter(r=>r.pageOverflow||r.panel&&(!r.panel.bounds||r.panel.overflow||r.panel.hidden.length)||r.controls?.findings.length||r.steps.some(s=>s.overflow||s.positions.some(p=>!p.below||p.offset>.5)));
if(badSurfaces.length||controlResults.some(r=>r.overflow||r.findings.length))throw new Error('崩れまたは中央のずれを検出。measurements.jsonとcontrols.jsonを確認する');
