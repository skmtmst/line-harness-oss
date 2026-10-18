import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { connectGuardBrowser } from './browser-session.mjs'

const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')
const webRoot = new URL('../..', import.meta.url).pathname
const compiled = await build({
  stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import Dialog from './src/components/shared/dialog';import Drawer from './src/components/shared/drawer';
    import {TextField,TextArea} from './src/components/shared/text-field';
    function Fixture(){const [heading,setHeading]=useState(''),[description,setDescription]=useState(''),[closed,setClosed]=useState(false);
      const Widget=window.fixtureKind==='drawer'?Drawer:Dialog;
      return <><Widget open={!closed} title="入力の確認" onClose={()=>setClosed(true)} onCancel={()=>setClosed(true)}>
        <TextField aria-label="見出し" value={heading} onChange={event=>setHeading(event.target.value)}/>
        <TextArea aria-label="説明" value={description} onChange={event=>setDescription(event.target.value)}/>
      </Widget><output id="state">{JSON.stringify({heading,description,closed})}</output></>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: `${webRoot}/tsconfig.json`,
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:8788"' },
  plugins: [{ name: 'fixture', setup(build) {
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
    build.onResolve({ filter: /^next\/link$|^@\/components\/shared\/list-navigation$/ }, () => ({ path: 'link', namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'navigation'
      ? 'export const useRouter=()=>({push(){},replace(){}});export const usePathname=()=>"/fixture";export const useSearchParams=()=>new URLSearchParams();'
      : 'import React from "react";export default function Link(p){return React.createElement("a",p)}', resolveDir: webRoot }))
    // この試験は値と破棄の確認を守る。寸法と色は別の画面検査が守る。
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default {}', loader: 'js' }))
  } }],
})

for (const kind of ['dialog', 'drawer']) test(`${kind} keeps the first controlled input and still confirms discard`, async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setContent('<div id="root"></div>')
    await page.evaluate(kind => { window.fixtureKind = kind }, kind)
    await page.addScriptTag({ content: compiled.outputFiles[0].text })
    await page.getByRole('textbox', { name: '見出し', exact: true }).fill('最初に打った見出し')
    await page.getByRole('textbox', { name: '説明', exact: true }).fill('続けて打った説明')
    const state = () => page.locator('#state').textContent().then(JSON.parse)
    assert.deepEqual(await state(), { heading: '最初に打った見出し', description: '続けて打った説明', closed: false })
    await page.keyboard.press('Escape')
    const confirmation = page.getByRole('dialog', { name: '入力を破棄しますか？' })
    await confirmation.waitFor()
    assert.equal((await state()).closed, false)
    await confirmation.getByRole('button', { name: '破棄する', exact: true }).click()
    assert.equal((await state()).closed, true)
  } finally { await browser.close() }
})
