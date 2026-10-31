import test from 'node:test'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import scan from './owner-rules-browser.mjs'
const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')
const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const sheets = []
const compiled = await build({
 stdin: {resolveDir:webRoot,loader:'tsx',contents:`
import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import Bell from './src/components/shared/bell-popover';
import Accounts from './src/components/shared/account-switch-menu';
import HelpTip from './src/components/shared/help-tip';
import Select from './src/components/shared/select';
function Fixture(){const [open,setOpen]=useState(''),ref=useRef(null);return <main>
<button ref={ref} onClick={()=>setOpen('bell')}>通知を開く</button><button onClick={()=>setOpen('accounts')}>アカウントを開く</button>
<HelpTip label="数の説明">現在のアカウントの件数です。</HelpTip><Select aria-label="状態" value="all" options={[{value:'all',label:'すべて'}]} onChange={()=>{}}/>
<p>後ろの文字：作り直す・数のカード・設定</p>
<Bell open={open==='bell'} getAnchor={()=>ref.current} onClose={()=>setOpen('')} state="ready" items={[]} unreadCount={0} filter="all" onFilterChange={()=>{}} onSelect={()=>{}} onViewAll={()=>{}}/>
<Accounts open={open==='accounts'} getAnchor={()=>ref.current} onClose={()=>setOpen('')} accounts={[{id:'a',label:'検査用アカウント',basicId:'sample'}]} selectedAccountId="a" onSelect={()=>{}}/>
</main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig: webRoot+'/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
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
    b.onLoad({ filter: /\.css$/ }, async args => {
      sheets.push(await compileUiStyles(args.path))
      return { contents: '', loader: 'js' }
    })
  } }],
})
const css = [await compileUiStyles(fileURLToPath(new URL('../../src/app/globals.css',import.meta.url)),['fixed','min-w-0']),...sheets].join('\n')
test('通知・切替・選択メニュー・吹き出しは不透明な白地と影で読み取れる',async()=>{
 const browser=await connectGuardBrowser()
 try {const page=await browser.newPage({reducedMotion:'reduce'})
  for(const width of [1440,1152]) {
   await page.setViewportSize({width,height:900})
   await page.setContent(`<html data-theme="v8"><style>${css}main{padding:32px}body{background:#f2f3f5}</style><div id="root"></div></html>`)
   await page.addScriptTag({content:compiled.outputFiles[0].text})
   for(const [name,selector] of [['通知を開く','[role="dialog"]'],['アカウントを開く','[role="menu"]'],['状態','[data-menu-portal]:has([role="listbox"])'],['数の説明','[role="note"]']]) {
    await page.getByRole('button',{name,exact:true}).click()
    const surface=page.locator(selector);await surface.waitFor(); if(await page.locator('[data-menu-portal]').count()) await page.locator('[data-menu-portal][data-ready="true"]').waitFor()
    await page.waitForFunction(element => element.getAnimations({ subtree: true }).every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState !== 'running'), await surface.elementHandle())
    const look=await surface.evaluate(el=>{const c=getComputedStyle(el);return {background:c.backgroundColor,shadow:c.boxShadow}})
    assert.equal(look.background,'rgb(255, 255, 255)',name)
    assert.notEqual(look.shadow,'none',name)
    assert.deepEqual((await page.evaluate(scan)).filter(item=>item.kind==='floating-surface-transparency'),[],name)
    if(process.env.MUSE_SHOTS){mkdirSync(process.env.MUSE_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.MUSE_SHOTS}/floating-${width}-${name}.png`})}
    const original=await surface.evaluate(el=>{const original=el.style.cssText;el.style.setProperty('transition','none','important');el.style.setProperty('background','rgba(255,255,255,.6)','important');return original})
    assert.ok((await page.evaluate(scan)).some(item=>item.kind==='floating-surface-transparency'),name+'故障対照')
    await surface.evaluate((el,original)=>{el.style.cssText=original},original)
    await page.keyboard.press('Escape')
   }
  }
 }finally{await browser.close()}
})
