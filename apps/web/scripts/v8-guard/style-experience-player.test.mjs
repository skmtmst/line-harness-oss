import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'

/*
 * スタイル体験の見本を管理画面と同じ値で描き、1024・1152・1440・1920 で崩れ（はみ出し・重なり・小さすぎる文字）を測る。
 * SXP_SHOT_DIR を渡すと各幅の撮影を残す（目で見る確かめ用）。
 */
const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')

const webRoot = new URL('../..', import.meta.url).pathname
const sheets = new Set()
const compiled = await build({
  stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {StyleExperiencePlayer,STYLE_EXPERIENCE_SCRIPT} from './src/v8/onboarding/style-experience-player';
function Fixture(){
 const params=new URLSearchParams(location.hash.slice(1));
 const [style,setStyle]=useState(params.get('style')||'restaurant');
 return <main data-fixture-board><StyleExperiencePlayer script={STYLE_EXPERIENCE_SCRIPT} style={style} onStyleChange={setStyle} switcher={params.get('switcher')||'segmented'} variant={params.get('variant')||'full'} data="sample" record={params.has('record')}/></main>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: `${webRoot}/tsconfig.json`, define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:8788"' },
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
    b.onResolve({ filter: /^@\/contexts\/account-context$/ }, () => ({ path: 'account', namespace: 'fixture' }))
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
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
/** 管理画面の外側：左のメニュー 240・白い板の左右 24。 */
const shell = 'body{margin:0;background:var(--color-canvas-sunken)}main{margin:24px 24px 24px 264px;padding:24px;background:#fff;border-radius:16px;box-sizing:border-box}'
const shotDir = process.env.SXP_SHOT_DIR

async function mount(page, width, hash = '', height = 1100) {
  await page.setViewportSize({ width, height })
  await page.setContent(`<html data-theme="v8"><style>${css}*{box-sizing:border-box}${shell}</style><div id="root"></div></html>`)
  await page.evaluate(value => { location.hash = value }, hash)
  await page.addScriptTag({ content: compiled.outputFiles[0].text })
  await page.locator('[data-style-experience]').waitFor()
  await page.evaluate(() => document.fonts.ready)
}

/** 崩れの計測：はみ出し・3 つの画面の重なり・器の外へ出た中身・縮めた後の文字の大きさ。 */
function measure() {
  const root = document.querySelector('[data-style-experience]')
  const box = el => el.getBoundingClientRect()
  const frame = root.querySelector('[data-pane="phone"]').parentElement
  const panes = [...root.querySelectorAll('[data-pane]')].map(el => ({ name: el.dataset.pane, rect: box(el) }))
  const overlaps = []
  for (let i = 0; i < panes.length; i++) for (let j = i + 1; j < panes.length; j++) {
    const a = panes[i].rect, b = panes[j].rect
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(`${panes[i].name}×${panes[j].name}`)
  }
  const frameRect = box(frame)
  const escaped = panes.filter(p => p.rect.right > frameRect.right + 0.5 || p.rect.left < frameRect.left - 0.5).map(p => p.name)
  // 画面の中の文字・押す形が、その画面の枠の外へ切れていないか（縮めた器は外を見せない）。
  for (const pane of root.querySelectorAll('[data-pane]')) {
    const edge = box(pane)
    for (const el of pane.querySelectorAll('button, a, [data-kpi-number], td, [role="cell"], [role="columnheader"]')) {
      const r = box(el)
      if (r.width === 0 || el.closest('[data-pane="phone"] [data-line-preview-part="talk"]')) continue
      if (r.right > edge.right + 0.5 || r.left < edge.left - 0.5) { escaped.push(`${pane.dataset.pane}:${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 12)}`); break }
    }
  }
  const scale = Number(getComputedStyle(root).getPropertyValue('--sxp-scale') || 1)
  let smallest = Infinity
  let smallestText = ''
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.textContent.trim()) continue
    const el = node.parentElement
    if (!el || el.getClientRects().length === 0 || el.closest('[aria-hidden="true"] [aria-hidden="true"]')) continue
    // スマホ枠は縮めない（部品の大きさのまま）。縮めた右の 2 画面だけを測る。
    if (el.closest('[data-pane="phone"]')) continue
    const size = parseFloat(getComputedStyle(el).fontSize) * scale
    if (size < smallest) { smallest = size; smallestText = `${node.textContent.trim().slice(0, 20)}（${getComputedStyle(el).fontSize}）` }
  }
  return {
    layout: root.dataset.layout,
    pageOverflow: document.documentElement.scrollWidth - innerWidth,
    rootOverflow: root.scrollWidth - root.clientWidth,
    overlaps, escaped, scale, smallest, smallestText,
    rootWidth: root.clientWidth,
  }
}

for (const width of [1024, 1152, 1440, 1920]) {
  test(`スタイル体験の見本は ${width} で崩れず、白い板が狭い時は縦に積む`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce' })
      for (const style of ['restaurant', 'salon', 'consult', 'standard', 'ec']) {
        await mount(page, width, `style=${style}`)
        const result = await page.evaluate(measure)
        assert.equal(result.pageOverflow <= 0, true, `${style} ${JSON.stringify(result)}`)
        assert.equal(result.rootOverflow <= 0, true, `${style} ${JSON.stringify(result)}`)
        assert.deepEqual(result.overlaps, [], `${style} ${JSON.stringify(result)}`)
        assert.deepEqual(result.escaped, [], `${style} ${JSON.stringify(result)}`)
        // 白い板 1100 未満（器 1052 未満）は積む。並べた時に縮めても文字は 10px 以上。
        assert.equal(result.layout, result.rootWidth < 1052 || (result.rootWidth - 354) / 800 < 10 / 11 ? 'stacked' : 'row', JSON.stringify(result))
        assert.ok(result.smallest >= 9.95, `${style} 文字 ${result.smallest}px ${JSON.stringify(result)}`)
        if (shotDir) {
          mkdirSync(shotDir, { recursive: true })
          await page.screenshot({ path: join(shotDir, `full-${style}-${width}-step5.png`), fullPage: true })
          // ①の段も撮る（動きを減らす設定は最後の段から始まるので、手順を押して戻す）。
          await page.locator('nav[data-part="steps"] button').first().click()
          await page.screenshot({ path: join(shotDir, `full-${style}-${width}-step1.png`), fullPage: true })
          const first = await page.evaluate(measure)
          assert.deepEqual([first.pageOverflow <= 0, first.rootOverflow <= 0, first.overlaps, first.escaped], [true, true, [], []], `${style} ① ${JSON.stringify(first)}`)
          assert.ok(first.smallest >= 9.95, `${style} ① ${JSON.stringify(first)}`)
        }
      }
      for (const style of ['restaurant', 'lesson']) {
        await mount(page, width, `style=${style}&switcher=external&variant=minimal`)
        const minimal = await page.evaluate(measure)
        assert.equal(minimal.pageOverflow <= 0 && minimal.rootOverflow <= 0, true, JSON.stringify(minimal))
        assert.deepEqual(minimal.overlaps, [])
        if (shotDir) await page.screenshot({ path: join(shotDir, `minimal-${style}-${width}.png`), fullPage: true })
      }
    } finally { await browser.close() }
  })
}

test('最小版と全部版は同じ大きさの枠に入る（並べた時）', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    const frameHeight = () => page.locator('[data-pane="phone"]').evaluate(el => el.parentElement.getBoundingClientRect().height)
    await mount(page, 1440, 'style=restaurant&switcher=external&variant=full')
    const full = await frameHeight()
    await mount(page, 1440, 'style=restaurant&switcher=external&variant=minimal')
    assert.equal(await frameHeight(), full)
  } finally { await browser.close() }
})

test('中の画面は押せず、押せるのは切り替え・止める・手順だけ', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference' })
    await page.clock.install()
    await mount(page, 1440)
    const reachable = []
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const name = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        return `${el.closest('[inert]') ? 'inert:' : ''}${el.closest('nav') ? 'steps:' : el.closest('[role="group"]') ? 'switch:' : ''}${el.getAttribute('aria-label') ?? el.textContent.trim()}`
      })
      if (!name || reachable.includes(name)) break
      reachable.push(name)
    }
    assert.equal(reachable.some(name => name.startsWith('inert:')), false, reachable.join(' / '))
    assert.ok(reachable.some(name => name.startsWith('switch:')), reachable.join(' / '))
    assert.ok(reachable.some(name => name.includes('止める')), reachable.join(' / '))
    assert.ok(reachable.some(name => name.startsWith('steps:')), reachable.join(' / '))
    // 中の部品へ焦点が入る形に壊すと、この計測が見つける。
    await page.locator('[data-pane="phone"]').evaluate(el => el.closest('[inert]').removeAttribute('inert'))
    await page.locator('[data-pane="board"] button').first().focus()
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-pane]'))), true)
  } finally { await browser.close() }
})

test('自動で段が進み、最後の段の後は次のスタイルへ。手順を押すとその段へ移る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference' })
    await page.clock.install()
    await mount(page, 1440)
    const scene = () => page.locator('[data-style-experience] [data-scene]').getAttribute('data-scene')
    // React の描き直しは本物の時間で走るので、1 段ずつ進めて描き直しを待つ。
    const advance = async (ms, expected) => { await page.clock.runFor(ms); await page.waitForFunction(value => document.querySelector('[data-style-experience] [data-scene]')?.getAttribute('data-scene') === value, expected) }
    assert.equal(await scene(), 'restaurant:reserve')
    await advance(3600, 'restaurant:accept')
    await page.getByRole('button', { name: '予約に戻る' }).click()
    assert.equal(await scene(), 'restaurant:reserve')
    // 押した直後には進まない（その段の頭から数え直す）。
    await page.clock.runFor(3000)
    await page.waitForTimeout(100)
    assert.equal(await scene(), 'restaurant:reserve')
    await advance(700, 'restaurant:accept')
    await advance(3600, 'restaurant:remind')
    await advance(3600, 'restaurant:visit')
    await advance(3600, 'restaurant:thanks')
    await advance(4100, 'salon:reserve')
    assert.equal(await page.getByRole('button', { name: 'サロン', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: '止める' }).click()
    await page.clock.runFor(10000)
    await page.waitForTimeout(100)
    assert.equal(await scene(), 'salon:reserve')
  } finally { await browser.close() }
})
