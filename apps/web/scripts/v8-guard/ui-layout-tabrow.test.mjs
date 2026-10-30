import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { connectGuardBrowser } from './browser-session.mjs'

/* 業種盤のタブ段：狭い幅では操作をタブの下へ折り返し、タブに重ねない（実部品・実CSS・実ブラウザ）。 */
const webRoot = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../package.json', import.meta.url))
const requireFromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(requireFromVitest.resolve('vite'))('esbuild')
const compiled = await build({
  stdin: { contents: `import {createElement as h} from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
import {Tabs} from './src/components/shared/tabs';
import SegmentedControl from './src/components/shared/segmented';
import Button from './src/components/shared/button';
const tabs = renderToStaticMarkup(h(Tabs, { label: 'サロンのタブ', size: 'compact', items: [
  { label: '台帳', current: true, onClick: () => {} },
  { label: '予約', onClick: () => {} },
  { label: 'お客さま', onClick: () => {} },
  { label: '分析', onClick: () => {} },
] }));
const sw = renderToStaticMarkup(h(SegmentedControl, { 'aria-label': '表示', appearance: 'track', size: 'small', fit: 'content', value: 'board', onChange: () => {}, options: [
  { value: 'board', label: '盤（時間×担当）' },
  { value: 'list', label: '一覧' },
  { value: 'calendar', label: 'カレンダー' },
] }));
const btn = renderToStaticMarkup(h('span', { className: 'tabAsideToggle' }, h(Button, { size: 'compact', 'aria-expanded': false, onClick: () => {} }, '新着・お支払いを見る')));
export const row = '<div class=\"tabRow\">' + tabs + '<div class=\"tabRowActions\">' + sw + btn + '</div></div>';`, resolveDir: webRoot, loader: 'tsx' },
  tsconfig: `${webRoot}/tsconfig.json`, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'css-module-fixture', setup(build) {
    build.onResolve({ filter: /^@line-crm\/shared$/ }, () => ({
      path: fileURLToPath(new URL('../../../../packages/shared/src/index.ts', import.meta.url)),
    }))
    build.onLoad({ filter: /\.module\.css$/ }, args => {
      const css = readFileSync(args.path, 'utf8')
      const names = Object.fromEntries([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map(match => [match[1], match[1]]))
      return { contents: `export default ${JSON.stringify(names)}`, loader: 'js' }
    })
  } }],
})
const fixtureModule = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, fixtureModule, fixtureModule.exports)
const web = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const css = web('src/app/globals.css')
  + web('src/components/shared/tabs.module.css')
  + web('src/components/shared/segmented.module.css')
  + web('src/components/shared/button.module.css')
  + web('src/v8/style-dashboard/style-dashboard.module.css')
  // 狭い幅の実態（右の列が畳み開閉ボタンが出る）に合わせる。
  + '.tabAsideToggle{display:contents!important}'
const html = (boardWidth) => `<style>${css}body{margin:0}</style><div data-theme="v8"><main style="width:${boardWidth}px">${fixtureModule.exports.row}</main></div>`

async function inspect(page, boardWidth) {
  await page.setContent(html(boardWidth))
  return page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')]
    const target = tabs.find((t) => t.textContent.trim() === '分析')
    const actions = document.querySelector('.tabRowActions')
    const r1 = target.getBoundingClientRect(), r2 = actions.getBoundingClientRect()
    const overlap = Math.min(r1.right, r2.right) > Math.max(r1.left, r2.left) + 1
      && Math.min(r1.bottom, r2.bottom) > Math.max(r1.top, r2.top) + 1
    const hit = document.elementFromPoint(r1.left + r1.width / 2, r1.top + r1.height / 2)
    const clipped = tabs.some((t) => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1)
    return { overlap, clickable: !!hit && (hit === target || target.contains(hit)), clipped }
  })
}

// 板幅：1024→760・1152→888・1440→1176（左メニュー240＋余白を除く）。
for (const [viewport, board] of [[1024, 760], [1152, 888], [1440, 1176]]) {
  test(`タブ段は${viewport}px相当でも分析タブと操作が重ならず押せる`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      const good = await inspect(page, board)
      assert.equal(good.overlap, false, `重なっている: ${JSON.stringify(good)}`)
      assert.equal(good.clickable, true, `押せない: ${JSON.stringify(good)}`)
      assert.equal(good.clipped, false, `タブが切れている: ${JSON.stringify(good)}`)
    } finally { await browser.close() }
  })
}

test('折返しを止めると狭い幅で重なりを検出する（感度の証拠）', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    // 混み合う幅を探す（業種・札の有無で前後するため適応的に）。
    let proof = null
    for (const board of [700, 680, 660, 640, 620]) {
      await page.setContent(html(board))
      const fault = await page.addStyleTag({ content: '.tabRow{flex-wrap:nowrap!important}' })
      const broken = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('[role="tab"]')]
        const target = tabs.find((t) => t.textContent.trim() === '分析')
        const actions = document.querySelector('.tabRowActions')
        const r1 = target.getBoundingClientRect(), r2 = actions.getBoundingClientRect()
        const overlap = Math.min(r1.right, r2.right) > Math.max(r1.left, r2.left) + 1
          && Math.min(r1.bottom, r2.bottom) > Math.max(r1.top, r2.top) + 1
        const clipped = tabs.some((t) => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1)
        return { overlap, clipped }
      })
      await fault.evaluate((el) => el.remove())
      if (broken.overlap || broken.clipped) {
        const good = await inspect(page, board)
        assert.equal(good.overlap, false, `戻しても重なる: ${JSON.stringify(good)}`)
        assert.equal(good.clipped, false, `戻しても切れる: ${JSON.stringify(good)}`)
        proof = { board, ...broken }
        break
      }
    }
    assert.ok(proof, '折返しを止めても壊れが出る幅が無い')
  } finally { await browser.close() }
})
