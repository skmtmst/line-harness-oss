import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import scanLayoutDefects from './layout-defects-browser.mjs'
import scanControlOverlap from './control-overlap-browser.mjs'
import { scanLayoutOverflow } from './layout-overflow.mjs'
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
    import SurfaceLayoutFixture from './scripts/v8-guard/surface-layout-fixture';

    function Fixture(){const [value,setValue]=useState('one');
      if(window.surfaceFixture)return <main><SurfaceLayoutFixture/></main>;
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
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
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

// globals.css の @import は展開しないため、Tailwind Preflight の余白リセットも再現する。
async function openSurfaces(page, width) {
  await page.setViewportSize({ width, height: 1128 })
  await page.setContent(`<html data-theme="v8"><style>${css}*{box-sizing:border-box;margin:0}body{margin:0}main{width:calc(100vw - 276px);margin:0 auto}main>section{margin-bottom:24px}</style><div id="root"></div></html>`)
  await page.evaluate(() => { window.surfaceFixture = true })
  await page.addScriptTag({ content: compiled.outputFiles[0].text })
  await page.locator('#flat').waitFor()
  await page.evaluate(() => document.fonts.ready)
}

/** 見出し・段・道具は製品の型が描く。画面固有のAPIや文言はこの検査の対象外。 */
function surfaceDistances() {
  const distance = (from, to) => Math.round((to.getBoundingClientRect().top - from.getBoundingClientRect().bottom) * 100) / 100
  const firstTool = id => document.querySelector(`#${id} [data-template-region="toolbar"]`).firstElementChild
  const title = id => document.querySelector(`#${id} [data-template-region="heading"] h2`)
  const step = id => document.querySelector(`#${id} [data-template-region="steps"]`)
  const content = id => document.querySelector(`#${id} [data-template-region="content"] [data-design-part="card"]`)
  const folders = document.querySelector('#common-vars [data-template-region="folders"]')
  return {
    hq: distance(title('hq'), firstTool('hq')),
    contents: distance(firstTool('contents'), content('contents')),
    banners: distance(firstTool('banners'), content('banners')),
    'common-vars': folders.offsetWidth ? distance(folders.firstElementChild, folders.lastElementChild) : null,
    'reminder-detail': distance(document.querySelector('#reminder-detail [data-template-region="heading"] p'), document.querySelector('#reminder-detail [data-template-region="heading-tabs"]')),
    ...Object.fromEntries(['auto-reply','reminder','hq-broadcast','scenario','rich-menu'].map(id => [id, distance(title(id), step(id))])),
  }
}

for (const width of [1440, 1152]) test(`共通の面と10画面の型は${width}pxで余白が重ならず、はみ出し・重なりがない`, async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await openSurfaces(page, width)
    const distances = await page.evaluate(surfaceDistances)
    console.log(JSON.stringify({ width, distances }))
    assert.deepEqual(distances, { hq: 16, contents: 14, banners: 14, 'common-vars': width === 1440 ? 8 : null, 'reminder-detail': 6, 'auto-reply': 8, reminder: 8, 'hq-broadcast': 2, scenario: 8, 'rich-menu': 8 })
    for (const id of ['contents', 'banners']) {
      const gap = await page.locator('#' + id).evaluate(el => el.querySelector('[data-template-region="toolbar"]').firstElementChild.getBoundingClientRect().top - el.querySelector('h2').getBoundingClientRect().bottom)
      assert.equal(gap, 14)
    }
    const sectionGaps = await page.evaluate(() => {
      const tools = document.querySelector('#section-with-tools [data-template-region="toolbar"]')
      const text = document.querySelector('#section-with-tools [data-template-region="content"] p')
      const noTools = document.querySelector('#section-without-tools')
      return [text.getBoundingClientRect().top - tools.firstElementChild.getBoundingClientRect().bottom,
        noTools.querySelector('p').getBoundingClientRect().top - noTools.querySelector('h2').getBoundingClientRect().bottom,
        document.querySelector('#section-with-tools [data-page-template]').getBoundingClientRect().bottom - text.getBoundingClientRect().bottom]
    })
    assert.deepEqual(sectionGaps, [14, 16, 24])
    const flat = await page.locator('#flat').evaluate(el => {
      const css = getComputedStyle(el)
      return { shadow: css.boxShadow, line: css.outlineWidth, padding: css.padding }
    })
    assert.equal(flat.shadow, 'none')
    assert.equal(flat.line, '1px')
    assert.notEqual(await page.locator('#raised').evaluate(el => getComputedStyle(el).boxShadow), 'none')
    assert.equal(await page.locator('#raised').evaluate(el => getComputedStyle(el).padding), flat.padding)
    assert.equal(await page.locator('#raised').evaluate(el => el.getBoundingClientRect().height), await page.locator('#flat').evaluate(el => el.getBoundingClientRect().height))
    for (const id of ['flat-form', 'flat-bordered', 'flat-outlined', 'flat-inset', 'selected-flat']) {
      assert.equal(await page.locator('#' + id).evaluate(el => getComputedStyle(el).boxShadow), 'none', id)
    }
    const fonts = await page.locator('#surfaces [data-part="create-summary"] dd').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).fontWeight))
    assert.deepEqual(fonts, ['400', '400'])
    for (const th of await page.locator('thead th').all()) assert.equal(await th.evaluate(el => getComputedStyle(el).fontWeight), '500')
    assert.equal(await page.locator('#hq h2').evaluate(el => getComputedStyle(el).fontWeight), '700')
    const iconColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-ink-secondary').trim())
    // 色の表記（hex/rgb）を同じ実CSSの計算結果へそろえて比較する。
    const neutral = await page.evaluate(color => { const el = document.createElement('span'); el.style.color = color; document.body.append(el); const result = getComputedStyle(el).color; el.remove(); return result }, iconColor)
    for (const target of ['[data-avatar="initials"]', '[data-avatar="icon"]', '[data-media-thumbnail]', '[data-dialog-choice-cards] a > span:first-child']) {
      assert.equal(await page.locator('#surfaces ' + target).evaluate(el => getComputedStyle(el).color), neutral, target)
    }
    assert.notEqual(await page.locator('#selected-flat').evaluate(el => getComputedStyle(el).backgroundColor), await page.locator('#flat').evaluate(el => getComputedStyle(el).backgroundColor))
    assert.equal(await page.locator('#surfaces button').evaluate(el => getComputedStyle(el).fontWeight), '500')
    assert.notEqual(await page.locator('#surfaces button').evaluate(el => getComputedStyle(el).backgroundColor), await page.locator('#flat').evaluate(el => getComputedStyle(el).backgroundColor))
    assert.deepEqual(await page.evaluate(scanLayoutDefects), [])
    assert.deepEqual(await page.evaluate(scanControlOverlap), [])
    assert.deepEqual(await page.evaluate(scanLayoutOverflow), { pageX: false, overflow: [], outOfMain: [], noTitle: [] })
  } finally { await browser.close() }
})

test('詳細タブに子の余白を戻す故障を実寸で見つけ、復元後に通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await openSurfaces(page, 1440)
    const tabs = page.locator('#reminder-detail [data-template-region="heading-tabs"]')
    assert.equal((await page.evaluate(surfaceDistances))['reminder-detail'], 6)
    await tabs.evaluate(el => { el.style.marginTop = '8px' })
    const broken = await page.evaluate(surfaceDistances)
    assert.throws(() => assert.equal(broken['reminder-detail'], 6))
    assert.equal(broken['reminder-detail'], 14)
    await tabs.evaluate(el => el.style.removeProperty('margin-top'))
    assert.equal((await page.evaluate(surfaceDistances))['reminder-detail'], 6)
  } finally { await browser.close() }
})
