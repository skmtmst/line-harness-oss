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
const sheets = new Set()
const compiled = await build({
  stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {CreatePage} from './src/components/templates/create-page';
    import TapActionField from './src/components/shared/tap-action-field';
    import Button from './src/components/shared/button';
    function Fixture(){const [value,setValue]=useState({kind:'uri',uri:'https://example.com',text:'',refId:''});
      return <CreatePage title="作成" dirty={false} footerActions={<Button>次へ</Button>}>
        <TapActionField name="面A" value={value} onChange={p=>setValue(v=>({...v,...p}))} hasLiff kindPresentation="grid"/>
        <input aria-label="名前" defaultValue="下書きを保持"/>
      </CreatePage>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: `${webRoot}/tsconfig.json`, define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:8788"' },
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
    b.onResolve({ filter: /^@\/contexts\/account-context$/ }, () => ({ path: 'account', namespace: 'fixture' }))
    b.onResolve({ filter: /^next\/link$|^@\/components\/shared\/list-navigation$/ }, () => ({ path: 'link', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'navigation'
      ? 'export const useRouter=()=>({push(){},replace(){},prefetch(){}});export const usePathname=()=>"/fixture";export const useSearchParams=()=>new URLSearchParams();'
      : args.path === 'account' ? 'export const useOptionalAccount=()=>null;export const useAccount=()=>({selectedAccountId:null,selectedAccount:null});'
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
const globals = await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname)
const css = [globals, ...sheets].join('\n').replace(/:global\(([^()]*)\)/g, '$1')

test('本物の作成型の選択肢は切れず、鍵盤選択と下書きを保つ', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152,1440,1920]) {
      await page.setViewportSize({width,height:900})
      await page.setContent(`<html data-theme="v8"><style>${css}*{box-sizing:border-box}body{margin:0}#root{padding:20px 24px 28px;width:calc(100% - 252px);margin-left:252px}</style><div id="root"></div></html>`)
      await page.addScriptTag({content:compiled.outputFiles[0].text})
      await page.getByRole('button',{name:'次へ',exact:true}).waitFor()
      const geometry = () => page.evaluate(() => {
        const frame=document.querySelector('[data-page-template="create"]'),footer=frame.querySelector('[data-template-region="footer"]')
        const a=frame.getBoundingClientRect(),b=footer.getBoundingClientRect()
        const choices=[...frame.querySelectorAll('[data-shared-part="tap-action-choices"] label')]
        return {height:a.height,bottomGap:a.bottom-b.bottom,columns:new Set(choices.map(el=>el.getBoundingClientRect().left)).size,
          clipped:choices.filter(el=>{const label=el.querySelector('span');return label.scrollWidth>label.clientWidth}).length,
          icons:choices.filter(el=>el.querySelector('svg')).length,overflow:document.documentElement.scrollWidth-innerWidth}
      })
      const normal=await geometry()
      assert.equal(normal.clipped,0)
      assert.equal(normal.overflow,0)
      const first=page.getByRole('radio',{name:'URLを開く',exact:true})
      await first.focus();await page.keyboard.press('ArrowRight')
      assert.equal(await page.getByRole('radio',{name:'テキストを送る',exact:true}).isChecked(),true)
      assert.equal(await page.getByLabel('名前',{exact:true}).inputValue(),'下書きを保持')
    }
  } finally { await browser.close() }
})
