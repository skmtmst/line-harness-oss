import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { connectGuardBrowser } from './browser-session.mjs'

const webRoot = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../package.json', import.meta.url))
const requireFromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(requireFromVitest.resolve('vite'))('esbuild')
// Draw the actual row. CSS module names stay local class names for the stylesheet fixture.
const compiled = await build({
  stdin: { contents: `import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ActionRow} from './src/components/shared/action-list'; export const row = renderToStaticMarkup(createElement(ActionRow, { title:'本人にLINEで知らせる',kind:'LINE',number:1,open:true,onToggle:()=>{},extra:'成果1件ごとに' }, createElement('input',{'aria-label':'すること',defaultValue:'LINEで知らせる'}),createElement('input',{'aria-label':'対象',defaultValue:'付けるタグ'})));`, resolveDir: webRoot, loader: 'tsx' },
  tsconfig: `${webRoot}/tsconfig.json`, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'css-module-fixture', setup(build) {
    build.onResolve({ filter: /^@line-crm\/shared$/ }, () => ({
      path: fileURLToPath(new URL('../../../../packages/shared/src/index.ts', import.meta.url)),
    }))
    build.onLoad({ filter: /\.module\.css$/ }, args => {
      const css = readFileSync(args.path, 'utf8')
      const names = Object.fromEntries([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map(match => [match[1],match[1]]))
      return { contents: `export default ${JSON.stringify(names)}`, loader: 'js' }
    })
  } }],
})
const fixtureModule = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, fixtureModule, fixtureModule.exports)
const styles = { editor: 'editor' }
const css = readFileSync(new URL('../../src/components/shared/action-list.module.css', import.meta.url), 'utf8')
const globals = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')
const html = `<style>${globals}${css}body{margin:0}</style><div data-theme="v8"><main style="width:calc(100% - 48px);margin:24px">${fixtureModule.exports.row}</main></div>`

// Exercise the real ActionRow at a mobile viewport without fixing its column/row shape.
test('狭い幅の設定欄は重ならず画面内に収まり、はみ出し故障を検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
    await page.setContent(html)
    const inspect = () => page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')].map(input => input.getBoundingClientRect())
      const overlaps = inputs.some((a, i) => inputs.slice(i + 1).some(b =>
        Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1
        && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1))
      return { overlaps, outside: inputs.some(r => r.left < 0 || r.right > innerWidth), pageX: document.documentElement.scrollWidth > innerWidth }
    })
    const usable = { overlaps: false, outside: false, pageX: false }
    assert.deepEqual(await inspect(), usable)
    const fault = await page.addStyleTag({ content: `.${styles.editor}{display:grid!important;grid-template-columns:190px 260px!important}` })
    const broken = await inspect()
    assert.ok(broken.outside || broken.pageX)
    await fault.evaluate(el => el.remove())
    assert.deepEqual(await inspect(), usable)
  } finally { await browser.close() }
})
