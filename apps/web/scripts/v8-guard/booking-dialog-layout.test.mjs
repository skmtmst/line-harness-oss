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
import ReservationBoard from './src/components/shared/reservation-board';
import Dialog from './src/components/shared/dialog';
import Drawer from './src/components/shared/drawer';
const statuses=['requested','confirmed','confirmed','no_show'];
const entries=statuses.map((status,i)=>({id:String(i),kind:'seats',version:1,scopeId:'s',startsAt:'2026-09-03T09:00:00Z',endsAt:'2026-09-03T10:30:00Z',status,customerName:['承認を待つ予約','期限付きの仮押さえ','確定した予約','無断キャンセル'][i],guestCount:2,resourceIds:['t'+i],resourceLabel:'卓'+i,source:'phone',courseName:null,note:null,dining:null,holdExpiresAt:i===1?'2026-09-03T10:00:00Z':null}));
function Fixture(){const [kind,setKind]=useState(''),[lines,setLines]=useState(1),[opened,setOpened]=useState('');const description=lines===1?'説明の文です。':<>説明の一行目です。<br/>説明の二行目です。</>;return <main>
<ReservationBoard entries={entries} resources={entries.map(e=>({id:e.resourceIds[0],label:e.resourceLabel,active:true,capacity:2}))} dates={['2026-09-03']} onOpen={setOpened}/><output>{opened}</output>
{['confirm','create','drawer'].map(k=><button key={k} onClick={()=>setKind(k)}>{k}</button>)}
<button onClick={()=>setLines(lines===1?2:1)}>説明を切り替える</button>
{kind==='drawer'?<Drawer open title="引き出しの題" description={description} onClose={()=>setKind('')}><p>本文</p></Drawer>:<Dialog open={!!kind} title={kind==='create'?'作る窓の題':'確認の題'} description={description} steps={kind==='create'?<span>手順</span>:undefined} confirmation={kind==='confirm'} onCancel={()=>setKind('')} onConfirm={()=>setKind('')} confirmLabel="保存する">{kind==='create'?<input aria-label="名前"/>:null}</Dialog>}
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

async function mount(page, width) {
  await page.setViewportSize({width,height:1000})
  await page.clock.setFixedTime(new Date('2026-09-03T09:24:00Z'))
  await page.setContent(`<html><style>${css}main{padding:24px}</style><div id="root"></div></html>`)
  await page.addScriptTag({content:compiled.outputFiles[0].text})
  await page.getByRole('button',{name:'confirm',exact:true}).waitFor()
}

for (const width of [1152,1440]) test(`予約と窓の文字が切れず、状態と操作が保たれる ${width}`, async () => {
  const browser = await connectGuardBrowser()
  const page = await browser.newPage({deviceScaleFactor:2,reducedMotion:'reduce'})
  try {
    await mount(page,width)
    if (process.env.FAULT_BOOKING_LAYOUT) await page.addStyleTag({content:'[data-placement="timeline"]{max-height:24px!important}'})
    const metrics = await page.evaluate(() => {
      const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}}
      const cards=[...document.querySelectorAll('button[data-placement="timeline"]')].map(e=>{
        const b=box(e),s=getComputedStyle(e),texts=[e.firstElementChild,...e.lastElementChild.children].map(t=>({text:t.textContent,box:box(t),scroll:t.scrollHeight,client:t.clientHeight}))
        return {state:e.dataset.bookingState,box:b,border:parseFloat(s.borderTopWidth),texts}
      })
      const now=document.querySelector('[data-booking-now]'),label=box(now.firstElementChild)
      const ticks=[...document.querySelectorAll('[class*="timeHead"]>span')].map(e=>{const r=document.createRange();r.selectNodeContents(e);return box(r)})
      const legend=[...document.querySelectorAll('[aria-label="予約の状態"] [role="listitem"]')].map(e=>e.textContent)
      return {cards,label,ticks,legend,overflow:document.documentElement.scrollWidth-innerWidth}
    })
    assert.equal(metrics.overflow,0)
    assert.equal(metrics.cards.length,4)
    assert.equal(new Set(metrics.cards.map(c=>c.box.h)).size,1)
    for (const card of metrics.cards) {
      assert.equal(card.texts.length,3)
      for (const t of card.texts) {
        assert.ok(t.box.h>=16 && t.client>=t.scroll,JSON.stringify(t))
        assert.ok(t.box.y>=card.box.y+card.border && t.box.bottom<=card.box.bottom-card.border,JSON.stringify({card,t}))
      }
      assert.deepEqual(card.texts.map(t=>Math.round(t.box.y-card.box.y)),metrics.cards[0].texts.map(t=>Math.round(t.box.y-metrics.cards[0].box.y)))
    }
    for(const tick of metrics.ticks) assert.ok(metrics.label.bottom<=tick.y || metrics.label.y>=tick.bottom || metrics.label.right<=tick.x || metrics.label.x>=tick.right,'今の時刻と時刻の見出しが重ならない')
    assert.ok(metrics.legend.includes('要対応（承認待ち）'))
    assert.ok(metrics.legend.includes('重なり・受付数超過'))
    assert.equal(metrics.legend.filter(x=>x.startsWith('要対応')).length,1)
    await page.getByRole('button',{name:/承認を待つ予約/}).click()
    assert.equal(await page.locator('output').textContent(),'0')
    for (const kind of ['confirm','create','drawer']) for (const lines of [1,2]) {
      await page.getByRole('button',{name:kind,exact:true}).click()
      const panel=page.getByRole('dialog')
      await panel.waitFor()
      const gap=await panel.evaluate(e=>{
        const desc=document.getElementById(e.getAttribute('aria-describedby')),header=desc.closest('header,[class*="headerRow"]')
        const h=header.getBoundingClientRect(),d=desc.getBoundingClientRect()
        return {gap:h.bottom-parseFloat(getComputedStyle(header).borderBottomWidth)-d.bottom,lineCount:d.height/parseFloat(getComputedStyle(desc).lineHeight)}
      })
      assert.equal(gap.gap,16,`${kind} ${lines}行`)
      assert.equal(gap.lineCount,lines)
      if(process.env.LAYOUT_SHOTS){const fs=await import('node:fs');fs.mkdirSync(process.env.LAYOUT_SHOTS,{recursive:true});await panel.screenshot({path:`${process.env.LAYOUT_SHOTS}/${kind}-${lines}line-${width}-2x.png`})}
      await panel.getByRole('button',{name:'閉じる',exact:true}).click()
      await panel.waitFor({state:'hidden'})
      await page.getByRole('button',{name:'説明を切り替える',exact:true}).click()
    }
    if(process.env.LAYOUT_SHOTS) await page.screenshot({path:`${process.env.LAYOUT_SHOTS}/booking-states-fixture-${width}-2x.png`})
  } finally { await page.close(); await browser.close() }
})
