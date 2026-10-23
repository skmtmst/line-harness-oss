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
import Button from './src/components/shared/button';
import SegmentedControl from './src/components/shared/segmented';
import Pagination from './src/components/shared/pagination';
import KpiCard from './src/components/shared/kpi-card';
import KpiBand from './src/components/shared/kpi-band';
import StatusBadge from './src/components/shared/status-badge';
import StatusPill from './src/components/shared/status-pill';
import Dialog from './src/components/shared/dialog';
import Drawer from './src/components/shared/drawer';
import {RowNameButton} from './src/components/shared/table';
function Fixture(){const[value,setValue]=useState('graph');const[window,setWindow]=useState('');return <main>
<Button variant="secondary">副操作</Button><Button variant="secondary" filterActive>絞り込み中</Button>
<Button variant="secondary" presentation="restaurant">店の副操作</Button><Button>主操作</Button>
<Pagination page={1} pageCount={3} onPageChange={()=>{}}/>
<KpiCard title="要対応" value={3} valueAction={{label:'数の内訳',expanded:false,onClick:()=>{}}}/>
<RowNameButton>行の名前</RowNameButton>
<SegmentedControl aria-label="表示" value={value} onChange={setValue} options={[{value:'graph',label:'グラフ'},{value:'table',label:'表'}]}/>
<SegmentedControl aria-label="選択札" appearance="choices" value="one" onChange={()=>{}} options={[{value:'one',label:'候補'}]}/>
<section data-measure-band><KpiBand><KpiCard title="集計" value={42}/></KpiBand></section>
<section data-measure-badges>{['neutral','success','info','warning','danger'].flatMap(tone=>[<StatusBadge key={'badge-'+tone} tone={tone}>{tone}</StatusBadge>,<StatusPill key={'pill-'+tone} tone={tone}>{tone}</StatusPill>])}</section>
<Button onClick={()=>setWindow('dialog')}>作る窓を開く</Button><Button onClick={()=>setWindow('drawer')}>引き出しを開く</Button>
<Dialog open={window==='dialog'} onCancel={()=>setWindow('')} title="作る窓"><p>本文</p></Dialog>
<Drawer open={window==='drawer'} onClose={()=>setWindow('')} title="引き出し"><p>本文</p></Drawer>
</main>}createRoot(document.getElementById('root')).render(<Fixture/>);` },
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
      sheets.push(css)
      return { contents: `export default ${JSON.stringify(names)}`, loader: 'js' }
    })
  } }],
})
const css = [await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname), ...sheets].join('\n')
async function mount(page) {
  await page.setContent(`<html><style>${css}body{color:var(--color-ink)}main{display:flex;gap:16px;align-items:center;padding:24px}</style><div id="root"></div></html>`)
  await page.addScriptTag({content:compiled.outputFiles[0].text})
  await page.getByRole('button',{name:'副操作',exact:true}).waitFor()
}
const focusedRing = page => page.evaluate(() => {
  const control=document.activeElement,style=getComputedStyle(control)
  return control.matches(':focus-visible') && style.outlineStyle!=='none' && parseFloat(style.outlineWidth)>=2
})

test('塗りと絞り込み状態があってもキーボードの焦点を見失わない', async () => {
  const browser=await connectGuardBrowser()
  try {
    const page=await browser.newPage({reducedMotion:'reduce'})
    await mount(page)
    for(const name of ['副操作','絞り込み中','店の副操作','主操作']){
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(()=>document.activeElement.textContent),name)
      assert.equal(await focusedRing(page),true,name)
    }
    for(const name of ['1ページ目へ','2ページ目へ','次のページ','数の内訳','行の名前']){
      await page.getByRole('button',{name,exact:true}).press('Shift')
      assert.equal(await focusedRing(page),true,name)
    }
    // 輪郭を消す故障を実際の描画へ入れ、同じ検査が見逃さないことを確かめる。
    const fault=await page.addStyleTag({content:'button:focus-visible{outline:none!important}'})
    assert.equal(await focusedRing(page),false)
    await fault.evaluate(el=>el.remove())
    assert.equal(await focusedRing(page),true)
  } finally { await browser.close() }
})

test('表示切替は白いつまみで追従し、クリック・矢印と動きを減らす設定を保つ', async () => {
  const browser=await connectGuardBrowser()
  try {
    for(const reducedMotion of ['reduce','no-preference']){
      const page=await browser.newPage({reducedMotion})
      await mount(page)
      const group=page.getByRole('group',{name:'表示',exact:true})
      const graph=group.getByRole('button',{name:'グラフ',exact:true})
      const table=group.getByRole('button',{name:'表',exact:true})
      await table.click()
      assert.equal(await table.getAttribute('aria-pressed'),'true')
      await page.waitForFunction(()=>{
        const group=document.querySelector('[aria-label="表示"]'),thumb=group.querySelector('[aria-hidden="true"]'),selected=group.querySelector('[aria-pressed="true"]')
        return Math.abs(thumb.getBoundingClientRect().left-selected.getBoundingClientRect().left)<1 && Math.abs(thumb.getBoundingClientRect().width-selected.getBoundingClientRect().width)<1
      })
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="表示"] [aria-pressed="true"]')).color===getComputedStyle(document.body).color)
      const surface=await group.evaluate(el=>({
        thumb:getComputedStyle(el.querySelector('[aria-hidden="true"]')).backgroundColor,
        ink:getComputedStyle(el.querySelector('[aria-pressed="true"]')).color,
        expected:getComputedStyle(document.body).color,
      }))
      assert.equal(surface.thumb,'rgb(255, 255, 255)')
      assert.equal(surface.ink,surface.expected)
      await table.press('ArrowLeft')
      assert.equal(await graph.getAttribute('aria-pressed'),'true')
      assert.equal(await page.getByRole('group',{name:'選択札',exact:true}).getByRole('button').getAttribute('aria-pressed'),'true')
      await page.close()
    }
  } finally { await browser.close() }
})


test('数の帯と窓は共通の値で描かれ、状態札の文字は読める濃さを保つ', async () => {
  const browser=await connectGuardBrowser()
  try {
    const page=await browser.newPage({reducedMotion:'reduce'})
    await mount(page)
    const numbers=page.locator('[data-measure-band] [data-kpi-number]')
    const metric=await numbers.evaluate(el=>{const s=getComputedStyle(el);return{size:s.fontSize,line:s.lineHeight}})
    assert.deepEqual(metric,{size:'32px',line:'38px'})
    const ratios=await page.locator('[data-measure-badges] > span').evaluateAll(els=>els.map(el=>{
      const s=getComputedStyle(el),rgb=value=>value.match(/[0-9.]+/g).slice(0,3).map(Number)
      const light=channels=>channels.map(c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4}).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0)
      const a=light(rgb(s.color)),b=light(rgb(s.backgroundColor))
      return{tone:el.textContent,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)}
    }))
    assert.equal(ratios.length,10)
    for(const result of ratios)assert.ok(result.ratio>=4.5,JSON.stringify(result))
    for(const name of ['作る窓を開く','引き出しを開く']){
      await page.getByRole('button',{name,exact:true}).click()
      const panel=page.getByRole('dialog')
      await panel.waitFor()
      const shadows=await panel.evaluate(el=>{const s=getComputedStyle(el),probe=document.createElement('div');probe.style.boxShadow='var(--polish-window-shadow)';el.append(probe);const expected=getComputedStyle(probe).boxShadow;probe.remove();return{actual:s.boxShadow,expected}})
      assert.equal(shadows.actual,shadows.expected)
      assert.notEqual(shadows.actual,'none')
      await page.keyboard.press('Escape')
      await panel.waitFor({state:'hidden'})
    }
    await numbers.evaluate(el=>el.closest('[data-kpi-strip]').style.setProperty('--tpl-band-number-size','22px'))
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-measure-band] [data-kpi-number]')).fontSize!=='32px')
    assert.notEqual(await numbers.evaluate(el=>getComputedStyle(el).fontSize),'32px')
    await numbers.evaluate(el=>el.closest('[data-kpi-strip]').style.removeProperty('--tpl-band-number-size'))
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-measure-band] [data-kpi-number]')).fontSize==='32px')
    assert.equal(await numbers.evaluate(el=>getComputedStyle(el).fontSize),'32px')
  } finally { await browser.close() }
})
