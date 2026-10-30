import test from 'node:test'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'
const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')
const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const sheets = []
const compiled = await build({
 stdin: {resolveDir:webRoot,loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {TextField,TextArea} from './src/components/shared/text-field';
import Select from './src/components/shared/select';
import DateField from './src/components/shared/date-field';
import SearchField from './src/components/shared/search-field';
import Checkbox from './src/components/shared/checkbox';
import Combobox from './src/components/shared/combobox';
import TagPickerField from './src/components/shared/tag-picker-field';
import CheckCard from './src/components/shared/check-card';
import FileDropzone from './src/components/shared/file-drop';
import fsStyles from './src/components/shared/folder-select.module.css';
function Case({id,expect,ring,children}){return <div data-case={id} data-expect={expect} data-ring={ring} style={{margin:'8px 0'}}>{children}</div>}
function Fixture(){return <main>
<Case id="tf-ok" expect="blue" ring="self"><TextField aria-label="姓" value="" onChange={()=>{}} /></Case>
<Case id="tf-bad" expect="red" ring="self"><TextField aria-label="名" value="" onChange={()=>{}} invalid /></Case>
<Case id="ta-ok" expect="blue" ring="self"><TextArea aria-label="備考" value="" onChange={()=>{}} /></Case>
<Case id="ta-bad" expect="red" ring="self"><TextArea aria-label="詳細" value="" onChange={()=>{}} invalid /></Case>
<Case id="sel-ok" expect="blue" ring="self"><Select aria-label="都道府県" value="tokyo" options={[{value:'tokyo',label:'東京'}]} onChange={()=>{}} /></Case>
<Case id="sel-bad" expect="red" ring="self"><Select aria-label="市区" value="x" options={[{value:'x',label:'渋谷'}]} onChange={()=>{}} invalid /></Case>
<Case id="date-ok" expect="blue" ring="self"><DateField value="" onChange={()=>{}} aria-label="開始日" /></Case>
<Case id="date-bad" expect="red" ring="self"><DateField value="" onChange={()=>{}} aria-label="終了日" invalid /></Case>
<Case id="search-ok" expect="blue" ring="search"><SearchField aria-label="探す" value="" onChange={()=>{}} /></Case>
<Case id="search-bad" expect="red" ring="search"><SearchField aria-label="絞る" value="" onChange={()=>{}} aria-invalid="true" /></Case>
<Case id="check-ok" expect="blue" ring="check"><Checkbox checked={false} onCheckedChange={()=>{}}>同意する</Checkbox></Case>
<Case id="check-bad" expect="red" ring="check"><Checkbox checked={false} onCheckedChange={()=>{}} invalid>確認した</Checkbox></Case>
<Case id="combo-ok" expect="blue" ring="combo"><Combobox aria-label="品目" options={[{value:'a',label:'あ'}]} value="" onChange={()=>{}} /></Case>
<Case id="combo-bad" expect="red" ring="combo"><Combobox aria-label="数量" options={[{value:'a',label:'あ'}]} value="" onChange={()=>{}} error="選んでください" /></Case>
<Case id="tag-ok" expect="blue" ring="self"><TagPickerField label="札付け" value={[]} onChange={()=>{}} options={[{id:'t',name:'検'}]} accountId={null} /></Case>
<Case id="tag-bad" expect="red" ring="self"><TagPickerField label="札直し" value={[]} onChange={()=>{}} options={[{id:'t',name:'検'}]} accountId={null} invalid /></Case>
<Case id="card-ok" expect="blue" ring="card"><CheckCard checked={false} onChange={()=>{}} title="送る" /></Case>
<Case id="card-bad" expect="red" ring="card"><CheckCard checked={false} onChange={()=>{}} title="止める" invalid /></Case>
<Case id="drop-ok" expect="blue" ring="self"><FileDropzone variant="upload" aria-label="置く" onFiles={()=>{}} /></Case>
<Case id="drop-bad" expect="red" ring="self"><FileDropzone variant="upload" aria-label="足す" onFiles={()=>{}} invalid /></Case>
<Case id="fs-ok" expect="blue" ring="self"><input type="text" aria-label="箱名" className={fsStyles.field} defaultValue="" onChange={()=>{}} /></Case>
<Case id="fs-bad" expect="red" ring="self"><input type="text" aria-label="箱名誤" className={fsStyles.field} aria-invalid="true" defaultValue="" onChange={()=>{}} /></Case>
</main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig: webRoot+'/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},banner:{js:'var process=typeof process!=="undefined"?process:{env:{NODE_ENV:"production",NEXT_PUBLIC_API_URL:"http://127.0.0.1:8788"}};'},
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
const RED = 'rgb(185, 28, 28)'
const BLUE = 'rgb(37, 99, 235)'
/** 焦点の当たった欄の、輪を描く要素の輪郭を測る。 */
const RING = () => {
  const active = document.activeElement
  if (!active || active === document.body) return null
  const host = active.closest('[data-case]')
  if (!host) return null
  const kind = host.getAttribute('data-ring')
  const el = kind === 'search' ? active.closest('[data-search-field]')
    : kind === 'check' ? active.nextElementSibling
    : kind === 'combo' ? active.closest('[data-choice-field]')
    : kind === 'card' ? active.closest('label')
    : active
  if (!el) return null
  const c = getComputedStyle(el)
  return { id: host.getAttribute('data-case'), expect: host.getAttribute('data-expect'), color: c.outlineColor, style: c.outlineStyle, width: c.outlineWidth, shadow: c.boxShadow }
}
test('誤りの欄の焦点は赤1本、誤りなしは青（invalid-focus）', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.log('PAGEERROR:', String(e && e.stack || e).slice(0, 800)))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.setContent(`<html data-theme="v8"><style>${css}main{padding:32px}body{background:#f2f3f5}</style><div id="root"></div></html>`)
    await page.addScriptTag({ content: compiled.outputFiles[0].text })
    await page.locator('[data-case]').first().waitFor()
    const total = await page.locator('[data-case]').count()
    const seen = []
    for (let i = 0; i < total; i++) {
      // 同じ欄の2つ目以降の留まり（連想の開く印など）は飛ばし、未見の欄まで進む。
      let ring = null
      for (let skip = 0; skip < 6; skip++) {
        await page.keyboard.press('Tab')
        await page.waitForTimeout(120)
        ring = await page.evaluate(RING)
        if (ring && !seen.includes(ring.id)) break
      }
      assert.ok(ring && !seen.includes(ring.id), `Tab: 未見の欄に焦点が当たる`)
      // 輪の変わり目（120ms）の途中を避け、落ち着いた色を測る。
      const deadline = Date.now() + 3000
      for (;;) {
        ring = await page.evaluate(RING)
        if (ring && (ring.color === RED || ring.color === BLUE)) break
        if (Date.now() > deadline) break
        await page.waitForTimeout(50)
      }
      assert.ok(ring, `Tab ${i + 1}: 欄に焦点が当たる`)
      seen.push(ring.id)
      const want = ring.expect === 'red' ? RED : BLUE
      assert.equal(ring.color, want, `${ring.id}: 輪は${ring.expect === 'red' ? '赤' : '青'}`)
      assert.equal(ring.style, 'solid', `${ring.id}: 輪は実線`)
      assert.equal(ring.width, '2px', `${ring.id}: 輪は2px`)
      if (ring.expect === 'red') assert.ok(!ring.shadow.includes('37, 99, 235'), `${ring.id}: 青を重ねない`)
    }
    assert.equal(new Set(seen).size, total, '全部の欄を1回ずつ回った')
  } finally { await browser.close() }
})
