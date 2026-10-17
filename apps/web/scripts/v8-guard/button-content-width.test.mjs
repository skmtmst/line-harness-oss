import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { connectGuardBrowser } from './browser-session.mjs'
import scanFormRules from './form-rules-browser.mjs'

const webRoot = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../package.json', import.meta.url))
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')
const sheets = new Set()
const compiled = await build({
  stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import Button from './src/components/shared/button';
    import StickyBar from './src/components/shared/sticky-bar';
    import StickyBarAction from './src/components/shared/sticky-bar-action';
    import {GitCompare,Trash2} from 'lucide-react';
    function Fixture(){
      const [long,setLong]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
      return <><nav><button onClick={()=>setLong(v=>!v)}>文字を替える</button><button onClick={()=>setBusy(v=>!v)}>待機を替える</button><button onClick={()=>setDone(v=>!v)}>完了を替える</button></nav>
        <StickyBar destructive={<StickyBarAction destructive label="削除する" icon={Trash2}/>} actions={<Button variant="primary" widthReserve="dynamic" icon={<GitCompare aria-hidden="true"/>} busy={busy} done={done}><span data-label>{long?'12345か所に反映して保存':'保存する'}</span></Button>}/></>;
    } createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: `${webRoot}/tsconfig.json`, define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'browser-fixture', setup(build) {
    build.onResolve({ filter: /^@\/components\/shared\/list-navigation$/ }, () => ({ path: 'link', namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'import React from "react";export default function Link(p){return React.createElement("a",p)}', resolveDir: webRoot }))
    build.onLoad({ filter: /\.module\.css$/ }, args => {
      const css = readFileSync(args.path, 'utf8'); sheets.add(css)
      const names = Object.fromEntries([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => [m[1], m[1]]))
      return { contents: `export default ${JSON.stringify(names)}`, loader: 'js' }
    })
  } }],
})
const globals = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8').replace(/@theme\s*\{/g, ':root {')
const css = [globals, ...sheets].join('\n').replace(/:global\(([^()]*)\)/g, '$1')

test('実Buttonの短→長→短を3幅で測り、古い固定幅の故障は文字/印の切れで落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>${css}*{box-sizing:border-box}</style><div data-theme="v8" id="root"></div>`)
      await page.addScriptTag({ content: compiled.outputFiles[0].text })
      const action = page.locator('[data-sticky-actions] button')
      await action.waitFor()
      const measure = () => action.evaluate(el => {
        const box = el.getBoundingClientRect(), label = el.querySelector('[data-label]')
        const range = document.createRange(); range.selectNodeContents(label ?? el)
        const text = range.getBoundingClientRect(), icon = el.querySelector('svg')?.getBoundingClientRect()
        return { width: box.width, clipped: text.left < box.left || text.right > box.right || (icon && (icon.left < box.left || icon.right > box.right)), iconBefore: icon?.right <= text.left, icons: el.querySelectorAll('svg').length }
      })
      const short = await measure()
      await page.getByText('文字を替える', { exact: true }).click()
      await action.getByText('12345か所に反映して保存').waitFor()
      const long = await measure()
      assert.ok(long.width > short.width, '前の幅に固定されている')
      assert.equal(long.clipped, false)
      assert.equal(long.iconBefore, true)
      assert.equal(long.icons, 1)
      await action.evaluate((el, width) => { el.style.width = width + 'px' }, short.width)
      assert.equal((await measure()).clipped, true, '古い固定幅を戻した故障を検出する')
      await action.evaluate((el, width) => { el.style.width = width + 'px' }, long.width)
      await page.getByText('待機を替える', { exact: true }).click()
      await action.getByText('保存しています…').waitFor()
      assert.equal(await action.isDisabled(), true)
      assert.equal((await measure()).width, long.width)
      assert.equal(await action.locator('svg.lucide-loader-circle').count(), 1)
      await page.getByText('待機を替える', { exact: true }).click()
      await page.getByText('完了を替える', { exact: true }).click()
      await action.getByText('保存しました').waitFor()
      assert.equal((await measure()).width, long.width)
      assert.equal(await action.locator('svg.lucide-check').count(), 1)
      await action.getByText('12345か所に反映して保存').waitFor()
      await page.getByText('完了を替える', { exact: true }).click()
      await page.getByText('文字を替える', { exact: true }).click()
      await action.getByText('保存する', { exact: true }).waitFor()
      assert.equal((await measure()).width, short.width)
      assert.equal((await measure()).clipped, false)
      assert.equal(await action.locator('svg.lucide-git-compare').count(), 1)
    }
  } finally { await browser.close() }
})
