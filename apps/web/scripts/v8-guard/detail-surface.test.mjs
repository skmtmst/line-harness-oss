import test from 'node:test'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import scanDetailSurfaces from './detail-surface-browser.mjs'
const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')
const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const sheets = []
const compiled = await build({
 stdin: {resolveDir:webRoot,loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import DetailPanel from './src/components/shared/detail-panel';import Drawer from './src/components/shared/drawer';
import {DetailContent,DetailField,DetailFields,DetailSection,DetailPreview} from './src/components/shared/detail-content';import Button from './src/components/shared/button';
const root=createRoot(document.getElementById('root'));
window.renderFixture=(mode,empty=false)=>{const actions=empty?{}:{primary:<Button variant="primary">開く</Button>,secondary:<Button variant="secondary">配信結果</Button>,menuItems:[{id:'delete',label:'削除する',tone:'danger',onSelect(){}}]};const body=<DetailContent><DetailSection title="配信状況"><DetailField label="人数">12 人</DetailField><DetailFields><div><dt>補足の項目</dt><dd>中身の記録</dd></div></DetailFields></DetailSection></DetailContent>;
root.render(mode==='panel'?<DetailPanel open title="長い名前でも全文を確認できる題" onClose={()=>{}} actions={actions}>{body}</DetailPanel>:mode==='drawer'?<Drawer open title="長い名前でも全文を確認できる題" onClose={()=>{}} actions={actions}>{body}</Drawer>:<DetailPreview title="長い名前でも全文を確認できる題" actions={actions}>{body.props.children}</DetailPreview>)};
`},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig: webRoot+'/tsconfig.json',define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_API_URL':'"http://127.0.0.1:8788"'},
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({filter:/^@\/lib\/staff-role$/},()=>({path:'staff-role',namespace:'fixture'}))
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'staff-role' ? 'export const useStaffRole=()=>null;' : args.path === 'navigation'
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
    b.onLoad({ filter: /\.css$/ }, async args => {
      sheets.push(await compileUiStyles(args.path))
      return { contents: '', loader: 'js' }
    })
  } }],
})
const css = [await compileUiStyles(fileURLToPath(new URL('../../src/app/globals.css',import.meta.url)),['fixed','min-w-0']),...sheets].join('\n')
for(const width of [1152,1440]) for(const mode of ['panel','drawer','embedded']) {
 test(`右の面の題・1段の操作帯・本文を実描画と故障で確かめる ${mode} ${width}`,async()=>{
  const browser=await connectGuardBrowser()
  try {
   const page=await browser.newPage({reducedMotion:'reduce',viewport:{width,height:900}})
   await page.setContent(`<html data-theme="v8"><style>${css}body{margin:0}#root{height:800px} [data-detail-preview]{width:360px}</style><div id="root"></div></html>`)
   await page.addScriptTag({content:compiled.outputFiles[0].text})
   await page.evaluate(mode=>window.renderFixture(mode),mode)
   const panel=page.locator(mode==='embedded'?'[data-detail-preview]':`[data-design-part="${mode==='panel'?'detail-panel':'drawer'}"]`)
   await panel.waitFor();await page.locator('[data-detail-actions]').waitFor()
   await page.waitForFunction(()=>document.querySelector('[data-detail-actions] button')?.getBoundingClientRect().width>0)
   assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])
   const footer=panel.locator(':scope > footer'),title=panel.locator(':scope > header h2'),body=await panel.locator('[data-detail-content]').first().elementHandle()
   const restore=async(locator,mutate)=>{const old=await locator.evaluate(el=>el.style.cssText);await locator.evaluate(el=>el.style.setProperty('transition','none','important'));await locator.evaluate(mutate);const broken=await page.evaluate(scanDetailSurfaces);assert.notDeepEqual(broken,[],JSON.stringify(await locator.evaluate(el=>({tag:el.tagName,style:el.style.cssText,height:el.getBoundingClientRect().height,surfaces:[...document.querySelectorAll('[data-design-part="detail-panel"],[data-design-part="drawer"],[data-detail-preview]')].map(p=>({kind:p.dataset.designPart,body:!!p.querySelector(':scope > div > [data-detail-content]'),h:p.getBoundingClientRect().height,footer:p.querySelector(':scope > footer')?.getBoundingClientRect().height}))}))));await locator.evaluate((el,old)=>{el.style.cssText=old},old);await page.waitForFunction(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running'));await page.waitForFunction(()=>[...document.querySelectorAll('h2')].every(el=>Math.abs(parseFloat(getComputedStyle(el).fontSize)-16)<.1)&&[...document.querySelectorAll('[data-detail-label]')].every(el=>Math.abs(parseFloat(getComputedStyle(el).fontSize)-12)<.1)&&[...document.querySelectorAll('[data-detail-value]')].every(el=>Math.abs(parseFloat(getComputedStyle(el).fontSize)-14)<.1));assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])}
   await restore(footer,el=>el.style.setProperty('height','100px','important'))
   await restore(panel.locator('[data-detail-content]').first(),el=>el.style.setProperty('min-width','2000px','important'))
   await restore(panel.locator('[data-detail-fields] > div'),el=>{el.style.display='flex';el.style.alignItems='center'})

   await restore(title,el=>el.style.setProperty('white-space','normal','important'))
   await restore(title,el=>el.style.setProperty('text-overflow','clip','important'))
   const fullTitle=await title.getAttribute('title');await title.evaluate(el=>el.removeAttribute('title'))
   assert.ok((await page.evaluate(scanDetailSurfaces)).some(e=>e.kind==='detail-title'))
   await title.evaluate((el,value)=>el.setAttribute('title',value),fullTitle);assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])
   await restore(footer.locator('[data-variant="secondary"]'),el=>{el.style.setProperty('transition','none','important');el.style.setProperty('transform','translateY(8px)','important')})
   const duplicateMenu=await footer.locator('[data-row-menu]').evaluateHandle(el=>{const copy=el.cloneNode(true);el.parentElement.prepend(copy);return copy})
   assert.ok((await page.evaluate(scanDetailSurfaces)).some(e=>e.kind==='detail-footer'))
   await duplicateMenu.evaluate(el=>el.remove());assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])
   const headerMenu=await footer.locator('[data-row-menu]').evaluateHandle(el=>{const copy=el.cloneNode(true);el.closest('[data-design-part],[data-detail-preview]').querySelector(':scope > header').append(copy);return copy})
   assert.ok((await page.evaluate(scanDetailSurfaces)).some(e=>e.kind==='detail-header-menu'))
   await headerMenu.evaluate(el=>el.remove());assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])
   await body.evaluate(el=>el.removeAttribute('data-detail-content'))
   assert.ok((await page.evaluate(scanDetailSurfaces)).some(e=>e.kind==='detail-content'))
   await body.evaluate(el=>el.setAttribute('data-detail-content',''));assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])

   await restore(title,el=>el.style.setProperty('font-size','20px','important'))
   await restore(title,el=>el.style.setProperty('font-size','16px','important'))
   await restore(panel.locator('[data-detail-label]').first(),el=>{el.style.setProperty('transition','none','important');el.style.setProperty('font-size','14px','important')})
   await restore(panel.locator('[data-detail-value]').first(),el=>{el.style.setProperty('transition','none','important');el.style.setProperty('font-size','18px','important')})
   const extra=await page.locator('[data-detail-actions] [data-variant="secondary"]').evaluateHandle(el=>{const extra=el.cloneNode(true);el.parentElement.append(extra);return extra})
   assert.ok((await page.evaluate(scanDetailSurfaces)).some(e=>e.kind==='detail-footer'))
   await extra.evaluate(el=>el.remove());assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])
   const main=await page.locator('[data-detail-actions] [data-variant="primary"]').elementHandle()
   await main.evaluate(el=>el.parentElement.prepend(el));assert.ok((await page.evaluate(scanDetailSurfaces)).some(e=>e.kind==='detail-footer-order'))
   await main.evaluate(el=>el.parentElement.append(el));assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])
   const injected=await body.evaluateHandle(el=>{const button=document.createElement('button');button.setAttribute('data-shared-button','');button.setAttribute('data-variant','primary');button.textContent='本文の主操作';el.append(button);return button})
   assert.ok((await page.evaluate(scanDetailSurfaces)).some(e=>e.kind==='detail-body-action'))
   await injected.evaluate(el=>el.remove());assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])
   await page.getByRole('button',{name:'詳細のその他操作'}).click();await page.getByRole('menuitem',{name:/削除する/}).waitFor()
   assert.deepEqual(await page.evaluate(scanDetailSurfaces),[])
   await restore(page.getByRole('menuitem',{name:/削除する/}),el=>{el.style.setProperty('transition','none','important');el.style.setProperty('color','var(--color-ink-secondary)','important')})
   await page.keyboard.press('Escape')
   await page.evaluate(mode=>window.renderFixture(mode,true),mode)
   await page.waitForFunction(()=>!document.querySelector('[data-detail-actions]'))
   assert.equal(await panel.locator(':scope > footer').count(),0)
  } finally {await browser.close()}
 })
}
