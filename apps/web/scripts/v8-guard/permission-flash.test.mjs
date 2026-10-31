import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { observePermissionFrames, assertNoPermissionFlash } from './permission-flash-browser.mjs'

const require = createRequire(import.meta.url)
const { build } = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite'))('esbuild')
const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const globals = await compileUiStyles(join(webRoot, 'src/app/globals.css'), [])

async function fixture(fault) {
  return build({
    stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import ViewPermissionGate from './src/components/view-permission-gate';
      import HqAccessGate from './src/components/hq-access-gate';
      import {api} from './src/lib/api';
      api.staff.me=()=>new Promise(()=>{});
      import {rememberStaffIdentity} from './src/lib/staff-identity-state';
      let suspended = false, ready = false, release;
      function Screen(){if(suspended && !ready) throw new Promise(done=>{release=()=>{ready=true;done()}});return <h1>切り替え先の画面</h1>}
      function App(){const [count,setCount]=useState(0);return <><header style={{height:48}}>
        <button onClick={()=>{suspended=true;ready=false;setCount(count+1)}}>画面を切り替える</button>
        <button onClick={()=>release?.()}>画面を読み終える</button>
        <button onClick={()=>rememberStaffIdentity({role:'owner',accountScope:'all'})}>本人を読み終える</button>
        </header><main style={{padding:"20px 24px"}}><HqAccessGate><ViewPermissionGate><Screen key={count}/></ViewPermissionGate></HqAccessGate></main></>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    absWorkingDir: webRoot, tsconfig: join(webRoot, 'tsconfig.json'), bundle: true, write: false,
    outfile: 'permission-fixture.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.module.css': 'local-css' },
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:8788' }) },
    plugins: [{ name: 'gate-fixture', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: webRoot, contents: 'export const usePathname=()=>"/hq";export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(){},replace(){},prefetch(){}});' }))
      if (fault) builder.onLoad({ filter: /page-pending\.tsx$/ }, ({ path }) => ({
        loader: 'tsx', resolveDir: join(webRoot, 'src/components/templates'),
        contents: readFileSync(path, 'utf8').replace('<PageContent>', '<PageContent><h1>権限を確認しています</h1>'),
      }))
    } }],
  })
}
const bundles = await Promise.all([fixture(false), fixture(true)])
const artifactDir = process.env.V8_GUARD_ARTIFACT_DIR

for (const width of [1152, 1440]) test(`共通ゲートの待機・Suspenseと故障→赤→復元 ${width}`, async () => {
  const browser = await connectGuardBrowser()
  try {
    for (const [name, fault] of [['normal', false], ['fault', true], ['restored', false]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = []
      page.on('pageerror', error => { errors.push(error.message); console.error('fixture runtime:', error.message) })
      try {
        const bundle = bundles[Number(fault)]
        await page.setContent(`<html lang="ja" data-theme="v8"><style>${globals}\n${bundle.outputFiles.find(file => file.path.endsWith('.css')).text}</style><div id="root"></div></html>`)
        await page.evaluate(observePermissionFrames)
        await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text })
        await page.locator('[aria-busy=true]').waitFor({ timeout: 5000 })
        await page.waitForTimeout(450)
        assert.equal(await page.getByRole('heading', { name: '切り替え先の画面' }).count(), 0)
        await page.getByRole('button', { name: '本人を読み終える' }).click()
        await page.getByRole('heading', { name: '切り替え先の画面' }).waitFor({ timeout: 5000 })
        await page.getByRole('button', { name: '画面を切り替える', exact: true }).click()
        await page.locator('[aria-busy=true]').waitFor({ timeout: 5000 })
        if (artifactDir) {
          mkdirSync(artifactDir, { recursive: true })
          await page.screenshot({ path: join(artifactDir, `permission-${name}-${width}.png`) })
        }
        await page.waitForTimeout(100)
        await page.getByRole('button', { name: '画面を読み終える' }).click()
        await page.getByRole('heading', { name: '切り替え先の画面' }).waitFor({ state: 'visible', timeout: 5000 })
        const frames = await page.evaluate(() => { window.permissionFrames.stop(); return window.permissionFrames.frames })
        if (artifactDir) writeFileSync(join(artifactDir, `permission-${name}-${width}.json`), JSON.stringify(frames))
        if (fault) assert.throws(() => assertNoPermissionFlash(frames), /権限の文が切り替えに出ました/)
        else assertNoPermissionFlash(frames)
        assert.deepEqual(errors, [])
      } catch (error) {
        console.error('fixture state', (await page.locator('body').innerText()).slice(0, 1000));
        console.error('fixture errors', errors);
        throw error
      } finally { await page.close() }
    }
  } finally { await browser.close() }
})
