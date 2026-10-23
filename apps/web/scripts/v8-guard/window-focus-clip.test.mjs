import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'

const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')
const webRoot = new URL('../..', import.meta.url).pathname
const sheets = []
const compiled = await build({
  stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Dialog from './src/components/shared/dialog';
import Drawer from './src/components/shared/drawer';
import Button from './src/components/shared/button';
import {TextField,TextArea} from './src/components/shared/text-field';
import Select from './src/components/shared/select';
import DateField from './src/components/shared/date-field';
function Fixture(){const [kind,setKind]=useState(''),[value,setValue]=useState('a'),[date,setDate]=useState('2026-10-23');
const fields=<form style={{display:'grid',gap:16,width:'100%'}} onSubmit={e=>e.preventDefault()}>
<TextField aria-label="名前"/><Select aria-label="種類" value={value} onChange={setValue} options={[{value:'a',label:'種類A'},{value:'b',label:'種類B'}]} size="full"/>
<DateField aria-label="日付" value={date} onChange={setDate}/><TextArea aria-label="説明"/>
{Array.from({length:18},(_,i)=><TextField key={i} aria-label={'追加入力'+i}/>)}<TextArea aria-label="末尾の説明"/>
</form>;
return <main><TextField aria-label="窓の外の入力"/>{['dialog','inset','stacked','custom','drawer','drawer-inset','drawer-editor','drawer-composer'].map(k=><button key={k} onClick={()=>setKind(k)}>{k}</button>)}
{kind.startsWith('drawer')?<Drawer open title="入力の引き出し" description="入力して保存します。" dirty={false} layout={kind==='drawer-inset'?'inset':undefined} width={kind==='drawer-editor'?'editor':kind==='drawer-composer'?'composer':undefined} onClose={()=>setKind('')} footer={<Button onClick={()=>setKind('')}>保存する</Button>}>{fields}</Drawer>:<Dialog open={!!kind} title="入力の窓" description="入力して保存します。" dirty={false} layout={kind==='inset'?'inset':undefined} designLayout={kind==='stacked'?'stacked':undefined} designContentPadding={kind==='custom'?'0px':undefined} contentLayout="form" onCancel={()=>setKind('')} onConfirm={()=>setKind('')} confirmLabel="保存する">{fields}</Dialog>}
</main>}createRoot(document.getElementById('root')).render(<Fixture/>);
` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: `${webRoot}/tsconfig.json`, define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:8788"' },
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
    b.onResolve({ filter: /^next\/link$|^@\/components\/shared\/list-navigation$/ }, () => ({ path: 'link', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'navigation'
      ? 'export const useRouter=()=>({push(){},replace(){},prefetch(){}});export const usePathname=()=>"/fixture";export const useSearchParams=()=>new URLSearchParams();'
      : 'import React from "react";export default function Link(p){return React.createElement("a",p)}', resolveDir: webRoot }))
    b.onLoad({ filter: /\.module\.css$/ }, args => {
      const prefix = `fixture_${sheets.length}_`
      const names = {}
      const css = readFileSync(args.path, 'utf8').replace(/\.([A-Za-z][\w-]*)/g, (_, name) => {
        names[name] = prefix + name
        return `.${names[name]}`
      })
      sheets.push(css.replace(/:global\(([^()]+)\)/g, '$1'))
      return { contents: `export default ${JSON.stringify(names)}`, loader: 'js' }
    })
  } }],
})
const css = [await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname), ...sheets].join('\n')

const ringMetrics = page => page.evaluate(() => {
  const e=document.activeElement,s=getComputedStyle(e),b=e.getBoundingClientRect();
  const spread=Math.max(0,parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset));
  const clipped=[];
  for(let p=e.parentElement;p;p=p.parentElement){
    const style=getComputedStyle(p),r=p.getBoundingClientRect();
    const x=['auto','scroll','hidden','clip'].includes(style.overflowX),y=['auto','scroll','hidden','clip'].includes(style.overflowY);
    if((x&&(b.left-spread<r.left||b.right+spread>r.left+p.clientWidth))||(y&&(b.top-spread<r.top||b.bottom+spread>r.top+p.clientHeight)))clipped.push(p.className);
  }
  return {label:e.getAttribute('aria-label'),focused:e.matches(':focus-visible'),width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),color:s.outlineColor,clipped};
});
function assertRing(r){assert.equal(r.focused,true);assert.ok(r.width>=2);assert.notEqual(r.color,'rgba(0, 0, 0, 0)');assert.deepEqual(r.clipped,[],JSON.stringify(r));}

for(const width of [1152,1440])for(const kind of ['dialog','inset','stacked','custom','drawer','drawer-inset','drawer-editor','drawer-composer'])test(`窓内の入力と選択の焦点が切れず、本文だけを送れる ${kind} ${width}`,async()=>{
 const browser=await connectGuardBrowser(),page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:2,reducedMotion:'reduce'});
 try{
  await page.setContent(`<html><style>${css}main{padding:24px}</style><div id="root"></div></html>`);
  await page.addScriptTag({content:compiled.outputFiles[0].text});
  const outer=page.getByRole('textbox',{name:'窓の外の入力',exact:true});await outer.focus();assert.equal((await ringMetrics(page)).offset,2);
   await page.getByRole('button',{name:kind,exact:true}).click();
   const panel=page.locator('[data-design-part="dialog"],[data-design-part="drawer"]');await panel.waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const actions=panel.locator('[data-window-actions]');const before=await actions.boundingBox();
   for(const label of ['名前','種類','日付','説明','末尾の説明']){
    const field=page.getByLabel(label,{exact:true});await page.keyboard.press('Tab');await field.focus();await field.scrollIntoViewIfNeeded();await page.waitForTimeout(150);
    assertRing(await ringMetrics(page));
    if(process.env.FOCUS_SHOTS){const fs=await import('node:fs');fs.mkdirSync(process.env.FOCUS_SHOTS,{recursive:true});await panel.screenshot({path:`${process.env.FOCUS_SHOTS}/${kind}-${label}-${width}-2x.png`});}
   }
   const after=await actions.boundingBox();assert.equal(after.y,before.y,'下の操作は本文を送っても動かない');
   const scroll=await panel.locator(kind.startsWith('drawer')?'[class*="body"]':'[class*="content"]').first().evaluate(e=>({top:e.scrollTop,overflow:e.scrollWidth-e.clientWidth}));
   assert.ok(scroll.top>0);assert.equal(scroll.overflow,0);
   if(kind==='inset'){
    const field=page.getByLabel('名前',{exact:true});await field.focus();await field.scrollIntoViewIfNeeded();
    await panel.evaluate(e=>e.style.setProperty('--polish-focus-offset','2px'));
    // 本文側の正常値をわざと壊し、同じ切れの検査が落ちることを確かめる。
    const body=panel.locator('[class*="content"]').first();await body.evaluate(e=>e.style.setProperty('--polish-focus-offset','2px'));
    const broken=await ringMetrics(page);assert.throws(()=>assertRing(broken));
    await body.evaluate(e=>e.style.removeProperty('--polish-focus-offset'));await panel.evaluate(e=>e.style.removeProperty('--polish-focus-offset'));assertRing(await ringMetrics(page));
   }
   await panel.getByRole('button',{name:'閉じる',exact:true}).click();await panel.waitFor({state:'hidden'});
  await outer.focus();assert.equal((await ringMetrics(page)).offset,2);
 }finally{await page.close();await browser.close()}
});
