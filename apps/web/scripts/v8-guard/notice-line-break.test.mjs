import test from 'node:test'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
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
import Notice from './src/components/shared/notice';
function Fixture(){return <main>
<section id="login"><h2>ログインの要確認</h2><Notice tone="warn">ロボット対策の設定が済んでいないため、この環境では送信できません。運営にお問い合わせください。</Notice></section>
<section><h2>受信箱の失敗</h2><Notice tone="danger" compact onClose={()=>{}}>会話を読み込めませんでした。時間を置いてもう一度お試しください。</Notice></section>
<section><h2>飲食店の知らせ（段落・強調・リンク）</h2><Notice tone="warn" heading={<span>検証環境専用</span>}><p>ここで変えた内容は<strong>本番の予約や在庫</strong>には反映されません。設定の詳細は<a href="#details">こちらで確認できます</a>。</p></Notice></section>
<section><h2>統括の要確認</h2><Notice tone="warn" heading="送れなかった通知があります" action={<button type="button">確認する</button>}>送信の結果を確認してください。<a href="#details">お問い合わせ先</a>も確認できます。</Notice></section>
<section><h2>長いURLと1行の案内</h2><Notice tone="danger"><a href="#details">https://example.com/abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789</a></Notice><Notice tone="info" compact title="保存した内容を確認できます。">保存した内容を確認できます。</Notice></section>
<div id="details">検証用の案内先</div>
</main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig: webRoot+'/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},
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
const css = [await compileUiStyles(fileURLToPath(new URL('../../src/app/globals.css',import.meta.url)),[]),...sheets].join('\n')

// 字の座標から行を復元する。禁則処理で残る1〜2文字分と、句切りで大きく空く行を区別する。
const measureLines = (selector = '#login [data-notice-message]') => {
  const message = document.querySelector(selector)
  const lines = [], walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    for (let i = 0; i < node.length; i++) {
      const range = document.createRange()
      range.setStart(node, i); range.setEnd(node, i + 1)
      const rect = range.getBoundingClientRect()
      if (!rect.width) continue
      let line = lines.find(item => Math.abs(item.y - rect.y) < 2)
      if (!line) { line = { y: rect.y, text: '', right: 0 }; lines.push(line) }
      line.text += node.data[i]; line.right = Math.max(line.right, rect.right)
    }
  }
  return lines.sort((a, b) => a.y - b.y).map(line => ({ text: line.text, gap: message.getBoundingClientRect().right - line.right }))
}
const hasEarlyWrap = lines => lines.slice(0, -1).some(line => line.gap > 24)
// 句読点を字数へ含めず、『い。』も本文1字だけの行として数える。
const finalLineLength = lines => Array.from((lines.at(-1)?.text ?? '').replace(/[\s\p{P}]/gu, '')).length
const hasSingleCharacterLastLine = lines => lines.length > 1 && finalLineLength(lines) === 1
const findTextOverflow = () => [...document.querySelectorAll('[data-notice-message]')].flatMap(message => {
  if (getComputedStyle(message).whiteSpace === 'nowrap') return []
  const edge = message.getBoundingClientRect().right
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const range = document.createRange(); range.selectNodeContents(node)
    if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.right > edge + 1)) return [{ tone: message.closest('[data-tone]').dataset.tone }]
  }
  return []
})


test('知らせは文・段落・リンクを幅まで折り返し、短い案内の1行省略を保つ', async (t) => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [420, 1152, 1440]) {
      await page.setViewportSize({ width, height: 1100 })
      await page.setContent(`<html lang="ja" data-theme="v8"><style>${css}
body{margin:0;font-family:sans-serif}main{max-width:1100px;margin:auto;padding:24px}section{min-width:0;margin-bottom:24px}#login{width:352px;max-width:100%}@media(max-width:440px){#login{width:340px}}h2{font-size:14px;margin:0}p{margin:0}
</style><div id="root"></div></html>`)
      await page.addScriptTag({ content: compiled.outputFiles[0].text })
      await page.locator('[data-notice-message]').first().waitFor()
      const values = await page.locator('[data-notice-message], [data-notice-message] *').evaluateAll(elements => elements.filter(el => !el.closest('[data-notice-heading], [data-notice-status-word]')).map(el => getComputedStyle(el).wordBreak))
      assert.ok(values.every(value => value === 'normal'), 'JSXの中も全体の自動句切りを引き継がない')
      assert.ok((await page.locator('[data-notice-heading], [data-notice-status-word]').evaluateAll(elements => elements.map(el => getComputedStyle(el).wordBreak))).every(value => value === 'auto-phrase'), '短い題と頭の言葉は句切りを保つ')
      const lines = await page.evaluate(measureLines)
      assert.equal(hasEarlyWrap(lines), false, JSON.stringify(lines))
      assert.ok(finalLineLength(lines) >= 2, `最後の行に本文2字以上が入る: ${JSON.stringify(lines)}`)
      t.diagnostic(`${width}px: 最終行 ${finalLineLength(lines)}字・${lines.at(-1).text}`)
      assert.ok(lines.some(line => line.text.includes('お問い合わせ')), '再現幅ではお問い合わせを途中で切らない')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'URLも横にはみ出さない')
      assert.deepEqual(await page.evaluate(findTextOverflow), [], '全文を出す知らせは、文字が本文の右端を超えない')
      const compact = page.locator('[data-tone="info"][data-compact] [data-notice-message]')
      assert.equal(await compact.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap', '短い案内の省略は維持')
      assert.equal(await page.locator('[data-tone="danger"][data-compact] [data-notice-message]').evaluate(el => getComputedStyle(el).whiteSpace), 'normal', '失敗の文は全文を折り返す')
      assert.ok(await page.getByRole('button', { name: '通知を閉じる' }).isVisible())
      assert.ok(await page.getByRole('link', { name: 'こちらで確認できます' }).isVisible())
      if (process.env.NOTICE_SHOTS) {
        mkdirSync(process.env.NOTICE_SHOTS, { recursive: true })
        await page.screenshot({ path: `${process.env.NOTICE_SHOTS}/notice-variants-${width}.png`, fullPage: true })
      }
      // 故障対照：通常改行で1字だけが残る幅を探し、同じ幅のprettyが解消することを測る。
      const message = page.locator('#login [data-notice-message]')
      let orphanWidth = null
      for (let candidate = 280; candidate <= 330; candidate++) {
        await message.evaluate((el, value) => { el.style.flex = 'none'; el.style.width = `${value}px`; el.style.textWrap = 'wrap' }, candidate)
        if (hasSingleCharacterLastLine(await page.evaluate(measureLines))) { orphanWidth = candidate; break }
      }
      assert.notEqual(orphanWidth, null, '故障対照の1字残りを実際に再現する')
      t.diagnostic(`${width}px: 本文幅${orphanWidth}pxで通常改行の1字残りを検出`)
      await message.evaluate(el => { el.style.removeProperty('text-wrap') })
      assert.equal(hasSingleCharacterLastLine(await page.evaluate(measureLines)), false, 'prettyで同じ幅の1字残りが解消する')
      await message.evaluate(el => { el.style.removeProperty('flex'); el.style.removeProperty('width'); el.style.removeProperty('text-wrap') })
      if (width === 420) {
        const url = page.locator('[data-tone="danger"] a')
        await url.evaluate(el => { el.closest('[data-notice-message]').style.textWrap = 'pretty' })
        assert.ok((await page.evaluate(findTextOverflow)).length > 0, 'floatと長いURLのprettyは本文のはみ出しとして検出する')
        await url.evaluate(el => { el.closest('[data-notice-message]').style.removeProperty('text-wrap') })
        assert.deepEqual(await page.evaluate(findTextOverflow), [], 'リンクの通常改行ではみ出しが解消する')
      }
      // 故障対照：自動句切りによる不要な空きを検出し、通常改行で解消する。
      const fault = await page.addStyleTag({ content: '#login [data-notice-message], #login [data-notice-message] * {word-break:auto-phrase!important}' })
      assert.equal(hasEarlyWrap(await page.evaluate(measureLines)), true, '旧指定で不要な折り返しを検出する')
      await fault.evaluate(el => el.remove())
      assert.equal(hasEarlyWrap(await page.evaluate(measureLines)), false, '復元すると通る')
    }
  } finally { await browser.close() }
})
