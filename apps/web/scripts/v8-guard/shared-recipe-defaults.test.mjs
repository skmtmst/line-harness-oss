import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connectGuardBrowser } from './browser-session.mjs'

const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')

const webRoot = new URL('../..', import.meta.url).pathname
const sheets = new Set()
const compiled = await build({
  stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {EntityPickerField} from './src/components/shared/entity-picker';
    import {Field} from './src/components/shared/form-controls';
    import {CardHeader} from './src/components/shared/card';
    import LiffPhoneFrame from './src/components/shared/liff-phone-frame';
    import StickyBar from './src/components/shared/sticky-bar';

    import Button from './src/components/shared/button';
    function Fixture(){const [value,setValue]=useState('one');
      return <main>
        <section id="controls"><EntityPickerField label="使うテンプレート" noun="テンプレート" value={value} onChange={setValue} items={[{id:'one',name:'予約案内'},{id:'two',name:'来店のお礼'}]}/>
          <EntityPickerField label="空の選択" noun="テンプレート" value="" onChange={()=>{}} items={[]}/>
          {[undefined,'compact','input'].map((density,i)=><Field key={i} label={'名前'+i} htmlFor={'name'+i} density={density} required note="入力値を保持"><input id={'name'+i} defaultValue="保存前の内容"/></Field>)}
          {['standard','stacked','panel'].map(size=><CardHeader key={size} title={'段の題'+size} size={size} meta={<span data-fixture-meta={size}>届いた言葉で決めます。</span>}/>)}
        </section>
        <LiffPhoneFrame caption="お客さまに見える形" title="ご予約" accountName="店舗名"><p id="phone-body">スマホ本文の大きさ</p></LiffPhoneFrame>
        <StickyBar actions={<Button variant="primary">変更を保存</Button>}/>
      </main>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);
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
      let css = readFileSync(args.path, 'utf8')
      const globals = []
      css = css.replace(/:global\(([^()]*)\)/g, (_, selector) => `GLOBAL_SELECTOR_${globals.push(selector) - 1}`)
      const names = Object.fromEntries([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => [m[1], m[1]]))
      const prefix = `fixture_${sheets.size}_`
      for (const name of Object.keys(names)) names[name] = prefix + name
      css = css.replace(/\.([A-Za-z][\w-]*)/g, (_, name) => `.${names[name]}`)
        .replace(/GLOBAL_SELECTOR_(\d+)/g, (_, index) => globals[Number(index)])
      sheets.add(css)
      return { contents: `export default ${JSON.stringify(names)}`, loader: 'js' }
    })
    b.onLoad({ filter: /\.css$/ }, args => { sheets.add(readFileSync(args.path, 'utf8')); return { contents: '', loader: 'js' } })
  } }],
})
const globals = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8').replace(/@theme\s*\{/g, ':root {')
const css = [globals, ...sheets].join('\n').replace(/:global\(([^()]*)\)/g, '$1')

test('選ぶ操作・欄のラベル・説明・スマホ見本の題は役目の値で描き、旧値の故障を検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1440,1152,1920]) {
      await page.setViewportSize({width,height:1128})
      await page.setContent(`<html data-theme="v8"><style>${css}*{box-sizing:border-box}body{margin:0}main{width:calc(100% - 300px);margin:24px auto;display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px}input{width:100%}</style><div id="root"></div></html>`)
      await page.addScriptTag({content:compiled.outputFiles[0].text})
      await page.getByRole('button',{name:'変更を保存',exact:true}).waitFor()
      const styles = () => page.evaluate(() => {
        const read = el => {const s=getComputedStyle(el);return{size:s.fontSize,weight:s.fontWeight,color:s.color,line:s.lineHeight}}
        const text = text => [...document.querySelectorAll('span,p')].find(el=>el.textContent===text&&el.children.length===0)
        return {
          actions:[...document.querySelectorAll('#controls [data-entity-picker-field] > span[aria-hidden]')].map(read),
          labels:[...document.querySelectorAll('#controls label')].map(read),
          meta:['standard','stacked','panel'].map(size=>read(document.querySelector(`[data-fixture-meta="${size}"]`).parentElement)),
          caption:read(text('お客さまに見える形')),bar:read(text('ご予約')),body:read(document.querySelector('#phone-body')),
          overflow:document.documentElement.scrollWidth-innerWidth,
        }
      })
      const check = result => {
        assert.equal(result.actions.length,2)
        for(const action of result.actions){assert.equal(action.size,'13px');assert.equal(action.weight,'600')}
        assert.equal(result.labels.length,3)
        for(const label of result.labels){assert.equal(label.color,'rgb(74, 85, 101)');assert.equal(label.size,'12px');assert.equal(label.weight,'500')}
        for(const meta of result.meta)assert.equal(meta.size,'12px')
        assert.equal(result.caption.size,'15px');assert.equal(result.caption.weight,'700');assert.equal(result.caption.line,'23px')
        assert.equal(result.bar.size,'13px');assert.equal(result.overflow,0)
      }
      const normal=await styles();check(normal)
      const targets=[['#controls span:has(>svg)','font-size:12px'],['#controls span:has(>svg)','font-weight:400'],['#controls label','color:var(--color-ink)'],['[data-fixture-meta="stacked"]','font-size:11px'],['[data-fixture-meta="panel"]','font-size:11px'],['[data-liff-phone-frame]>p','font-size:12px'],['[data-liff-phone-frame]>p','font-weight:600'],['[data-liff-phone-frame]>p','line-height:18px'],['[data-liff-phone-frame] span','font-size:12px']]
      for(const [selector,declaration] of targets){
        // Meta inherits its actual header container's rule.
        const target=selector.includes('data-fixture-meta')?page.locator(selector).locator('..'):page.locator(selector)
        const originals=await target.evaluateAll(els=>els.map(el=>el.getAttribute('style')))
        await target.evaluateAll((els,value)=>els.forEach(el=>el.setAttribute('style',value+'!important')),declaration)
        const broken=await styles();assert.throws(()=>check(broken), `旧値の故障を検出: ${selector} ${declaration}`)
        await target.evaluateAll((els,values)=>els.forEach((el,i)=>values[i]===null?el.removeAttribute('style'):el.setAttribute('style',values[i])),originals)
      }
      await page.getByRole('button',{name:'使うテンプレート：変える'}).click()
      const dialog=page.getByRole('dialog',{name:'テンプレートを選ぶ'})
      await dialog.waitFor();await dialog.getByRole('button',{name:'キャンセル',exact:true}).click()
      for(const input of await page.locator('#controls input').all())assert.equal(await input.inputValue(),'保存前の内容')
      assert.deepEqual((await styles()).body,normal.body)
      const svg=page.getByRole('button',{name:'変更を保存'}).locator('svg')
      assert.equal(await svg.getAttribute('class').then(value=>value.includes('lucide-check')),true)
    }
  } finally { await browser.close() }
})
