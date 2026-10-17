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

    function Fixture(){const [value,setValue]=useState('one');
      return <main>
        <section id="controls"><EntityPickerField label="使うテンプレート" noun="テンプレート" value={value} onChange={setValue} items={[{id:'one',name:'予約案内'},{id:'two',name:'来店のお礼'}]}/>
          <EntityPickerField label="空の選択" noun="テンプレート" value="" onChange={()=>{}} items={[]}/>
          {[undefined,'compact','input'].map((density,i)=><Field key={i} label={'名前'+i} htmlFor={'name'+i} density={density} required note="入力値を保持"><input id={'name'+i} defaultValue="保存前の内容"/></Field>)}
        </section>
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

test('選択窓をキャンセルしても、別の入力欄に入れた内容を保つ', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1440,1152,1920]) {
      await page.setViewportSize({width,height:1128})
      await page.setContent(`<html data-theme="v8"><style>${css}*{box-sizing:border-box}body{margin:0}main{width:80vw;margin:1em auto}input{width:100%}</style><div id="root"></div></html>`)
      await page.addScriptTag({content:compiled.outputFiles[0].text})
      await page.getByRole('button',{name:'使うテンプレート：変える'}).click()
      const dialog=page.getByRole('dialog',{name:'テンプレートを選ぶ'})
      await dialog.waitFor();await dialog.getByRole('button',{name:'キャンセル',exact:true}).click()
      for(const input of await page.locator('#controls input').all())assert.equal(await input.inputValue(),'保存前の内容')

    }
  } finally { await browser.close() }
})
