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
const styles = { details: 'details', editor: 'editor' }
const css = readFileSync(new URL('../../src/components/shared/action-list.module.css', import.meta.url), 'utf8')
const globals = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')
const html = `<style>${globals}${css}body{margin:0}</style><div data-theme="v8"><main style="width:calc(100% - 48px);margin:24px">${fixtureModule.exports.row}</main></div>`

/*
 * #973 U023: 自動化の新規作成（/automations/new）で
 * 「すること」と「付けるタグ」などの対象設定が2列のまま潰れていた。
 * 旧クラス文字の固定でなく、実ActionRowの390pxの並びを守る。
 */

  test('狭い幅では名前と値を2段目に折り返し、右端を越えない（故障対照付き）', async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
      await page.setContent(html)
      const positions = () => page.evaluate(() => {
        const name = document.querySelector('[data-action-name]').getBoundingClientRect()
        const icon = document.querySelector('[data-action-row] svg').getBoundingClientRect()
        const value = document.querySelector('[data-action-value]').getBoundingClientRect()
        return { nameTop: name.top, iconBottom: icon.bottom, valueTop: value.top, nameBottom: name.bottom, overflow: document.documentElement.scrollWidth - innerWidth }
      })
      const good = await positions()
      assert.ok(good.nameTop > good.iconBottom)
      assert.ok(good.valueTop >= good.nameBottom)
      assert.equal(good.overflow, 0)
      await page.addStyleTag({ content: `.${styles.details}{flex-basis:auto!important;flex-wrap:nowrap!important;order:0!important}` })
      const broken = await positions()
      assert.ok(broken.nameTop <= broken.iconBottom || broken.valueTop < broken.nameBottom || broken.overflow > 0)
    } finally { await browser.close() }
  })

  test('設定欄は縦に並び、190px+260pxの2列へ戻す故障を検出する', async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
      await page.setContent(html)
      const positions = () => page.locator('input').evaluateAll(inputs => inputs.map(input => {
        const r = input.getBoundingClientRect(); return { x: r.left, top: r.top, bottom: r.bottom, right: r.right }
      }))
      const good = await positions()
      assert.equal(good.length, 2)
      assert.ok(good[1].top > good[0].bottom)
      assert.equal(good[1].x, good[0].x)
      assert.ok(good.every(r => r.right <= 390))
      await page.addStyleTag({ content: `.${styles.editor}{display:grid!important;grid-template-columns:190px 260px!important}` })
      const broken = await positions()
      assert.ok(broken[1].top < broken[0].bottom || broken.some(r => r.right > 390))
    } finally { await browser.close() }
  })
