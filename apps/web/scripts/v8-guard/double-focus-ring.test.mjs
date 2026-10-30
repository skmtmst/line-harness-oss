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
import {AffixedTextField} from './src/components/shared/text-field';
import Combobox from './src/components/shared/combobox';
import SearchField from './src/components/shared/search-field';
import CheckCard from './src/components/shared/check-card';
import RadioCard from './src/components/shared/radio-card';
import Checkbox from './src/components/shared/checkbox';
import TimeFieldV8 from './src/components/shared/time-field-v8';
import {InboxInputBox,InboxDraftArea} from './src/components/shared/inbox-composer';
import InsertTextField from './src/components/shared/insert-text-field';
import {MessageBody,MessageInsertButton} from './src/components/shared/message-insert-row';
function Case({id,expect,color,children}){return <div data-case={id} data-expect={expect} data-color={color} style={{margin:'8px 0'}}>{children}</div>}
function Fixture(){return <main>
<Case id="inbox-ok" expect="1" color="blue"><InboxInputBox><InboxDraftArea aria-label="返信" value="" onChange={()=>{}} /></InboxInputBox></Case>
<Case id="inbox-bad" expect="1" color="red"><InboxInputBox><InboxDraftArea aria-label="返信誤" value="" onChange={()=>{}} aria-invalid="true" /></InboxInputBox></Case>
<Case id="msgbody-ok" expect="1" color="blue"><MessageBody><textarea aria-label="本文" value="" onChange={()=>{}} /></MessageBody></Case>
<Case id="msgbody-bad" expect="1" color="red"><MessageBody><textarea aria-label="本文誤" value="" onChange={()=>{}} aria-invalid="true" /></MessageBody></Case>
<Case id="msgbody-insert-ok" expect="1" color="blue"><MessageBody><InsertTextField aria-label="差し込み本文" value="" onValueChange={()=>{}} /></MessageBody></Case>
<Case id="msgbody-insert-bad" expect="1" color="red"><MessageBody><InsertTextField aria-label="差し込み本文誤" value="" onValueChange={()=>{}} aria-invalid="true" /></MessageBody></Case>
<Case id="msgbody-btn-ok" expect="1" color="blue"><MessageBody><MessageInsertButton kind="name" label="名前" onClick={()=>{}} /></MessageBody></Case>
<Case id="msgbody-btn-locked" expect="1" color="blue"><MessageBody><MessageInsertButton kind="name" label="名前を差し込む" onClick={()=>{}} lockedReason="閲覧のみです" /></MessageBody></Case>
<Case id="affix-ok" expect="1" color="blue"><AffixedTextField aria-label="金額" startAdornment="¥" value="" onChange={()=>{}} /></Case>
<Case id="affix-bad" expect="1" color="red"><AffixedTextField aria-label="金額誤" startAdornment="¥" value="" onChange={()=>{}} invalid /></Case>
<Case id="time-ok" expect="1" color="blue"><TimeFieldV8 value="" onChange={()=>{}} aria-label="時刻" /></Case>
<Case id="checksolo-ok" expect="1" color="blue"><Checkbox checked={false} onCheckedChange={()=>{}}>同意する</Checkbox></Case>
<Case id="time-bad" expect="1" color="red"><TimeFieldV8 value="" onChange={()=>{}} aria-label="時刻誤" invalid /></Case>
<Case id="card-ok" expect="1" color="blue"><CheckCard checked={false} onChange={()=>{}} title="送る" /></Case>
<Case id="card-bad" expect="1" color="red"><CheckCard checked={false} onChange={()=>{}} title="止める" invalid /></Case>
<Case id="combo-ok" expect="1" color="blue"><Combobox aria-label="品目" options={[{value:'a',label:'あ'}]} value="" onChange={()=>{}} /></Case>
<Case id="search-ok" expect="1" color="blue"><SearchField aria-label="探す" value="" onChange={()=>{}} /></Case>
<Case id="radio-card-ok" color="blue"><RadioCard name="radio-ok" value="x" checked={false} title="前日" onChange={()=>{}} /></Case>
<Case id="radio-card-bad" color="red"><RadioCard name="radio-bad" value="x" checked={false} title="当日" onChange={()=>{}} invalid /></Case>
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
const GREEN = 'rgb(8, 122, 62)'
/** 焦点の当たった箱の中で、2pxの実線の輪が出ている要素を数える。1pxの地の枠は数えない。 */
const RINGS = () => {
  const active = document.activeElement
  if (!active || active === document.body) return null
  const host = active.closest('[data-case]')
  if (!host) return null
  const rings = []
  for (const el of host.querySelectorAll('*')) {
    const c = getComputedStyle(el)
    // 透明で見えない輪（チェックの本物の input など）は数えない。
    if (c.opacity === '0' || c.visibility === 'hidden') continue
    if (c.outlineStyle === 'solid' && c.outlineWidth === '2px' && c.outlineColor !== 'rgba(0, 0, 0, 0)') {
      rings.push(`${el.tagName.toLowerCase()}.${(el.className.baseVal !== undefined ? '' : String(el.className)).split(' ')[0]}:${c.outlineColor}`)
    }
  }
  const body = host.querySelector('[data-message-body]')
  const outer = body && getComputedStyle(body)
  const focus = getComputedStyle(active)
  return { id: host.getAttribute('data-case'), color: host.getAttribute('data-color'), rings,
    buttonFocused: active.matches('button'), outerWidth: outer?.outlineWidth, outerStyle: outer?.outlineStyle,
    activeWidth: focus.outlineWidth, activeStyle: focus.outlineStyle }
}
for (const width of [1152, 1440]) test(`箱で囲んだ入力は焦点の輪1本だけ（二重輪なし） ${width}`, async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.log('PAGEERROR:', String(e && e.stack || e).slice(0, 800)))
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(`<html data-theme="v8"><style>${css}main{padding:32px}body{background:#f2f3f5}</style><div id="root"></div></html>`)
    await page.addScriptTag({ content: compiled.outputFiles[0].text })
    await page.locator('[data-case]').first().waitFor()
    const total = await page.locator('[data-case]').count()
    const seen = []
    const results = []
    for (let i = 0; i < total; i++) {
      let found = null
      for (let skip = 0; skip < 8; skip++) {
        await page.keyboard.press('Tab')
        await page.waitForTimeout(150)
        const r = await page.evaluate(RINGS)
        if (r && !seen.includes(r.id)) { found = r; break }
      }
      assert.ok(found, `Tab: 未見の箱に焦点が当たる`)
      // 輪の変わり目の途中を避け、落ち着くまで待つ。
      const deadline = Date.now() + 3000
      for (;;) {
        const r = await page.evaluate(RINGS)
        if (r && r.id === found.id && r.rings.length > 0) { found = r; break }
        if (Date.now() > deadline) break
        await page.waitForTimeout(50)
      }
      seen.push(found.id)
      results.push(found)
    }
    assert.equal(new Set(seen).size, total, '全部の箱を1回ずつ回った')
    const bad = []
    for (const r of results) {
      const want = r.color === 'red' ? RED : r.color === 'green' ? GREEN : BLUE
      if (r.rings.length !== 1) bad.push(`${r.id}: 輪は1本だけ（${r.rings.join(' / ') || 'なし'}）`)
      else if (!r.rings[0].endsWith(want)) bad.push(`${r.id}: 輪は${r.color}（${r.rings[0]}）`)
    }
    for (const r of results.filter(r => r.id.startsWith('msgbody-btn-'))) {
      assert.equal(r.buttonFocused, true, `${r.id}: 差し込みボタンに焦点がある`)
      assert.equal(r.outerStyle, 'none', `${r.id}: 外枠には輪を出さない`)
      assert.equal(r.activeStyle, 'solid', `${r.id}: ボタン自身の輪を残す`)
      assert.equal(r.activeWidth, '2px', `${r.id}: ボタン自身の輪は共通の太さ`)
    }
    assert.equal(bad.length, 0, `二重輪あり:\n${bad.join('\n')}`)
  } finally { await browser.close() }
})
