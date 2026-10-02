/*
 * 7ページを 1152・1440 で撮る（時計を固定・動きを止める）。v7-pixel-diff の材料。
 *
 *   node apps/web/scripts/v8-guard/shots.mjs <baseUrl> <outDir> [v7|v8|both]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { ROUTES, openPage } from './browser-env.mjs'
import { collectTabsDiag } from './diag-collect.mjs'

/*
 * 撮影直後の読み取り診断（CI の 92px 差の不足条件を埋めるための材料）。
 * 守ること: 撮影条件（時計・2.5s 待機・動き・順番・画像・閾値・マスク）は変えない。
 * fonts の待ち足しはしない。読むだけで、画面も製品も変えない。秘密は拾わない。
 * reason は固定コードのみ（URL・query・error 文字列を入れない）。
 */
async function collectDiag(page, { theme, width, name, route }) {
  const base = { case: name, theme, width, route }
  try {
    const m = await page.evaluate(`(${collectTabsDiag.toString()})(document)`)
    if (!m) return { ...base, reason: 'tabs-row-not-found' }
    return { ...base, ...m }
  } catch {
    return { ...base, reason: 'evaluate-failed' }
  }
}

const [baseUrl, dir, themeArg = 'v7'] = process.argv.slice(2)
if (!baseUrl || !dir) throw new Error('使い方: shots.mjs <baseUrl> <outDir> [v7|v8|both]')
mkdirSync(dir, { recursive: true })
const themes = themeArg === 'both' ? ['v7', 'v8'] : [themeArg]
const browser = await chromium.launch()
let n = 0
for (const theme of themes) {
  for (const width of [1152, 1440]) {
    for (const [name, route] of Object.entries(ROUTES)) {
      const page = await openPage(browser, { baseUrl, route, width, theme, stable: true })
      await page.screenshot({ path: join(dir, `${theme}-${width}-${name}.png`) })
      const diag = await collectDiag(page, { theme, width, name, route })
      writeFileSync(join(dir, `${theme}-${width}-${name}.diag.json`), `${JSON.stringify(diag, null, 2)}\n`)
      await page.close()
      n += 1
    }
  }
}
await browser.close()
console.log(`撮影 ${n} 枚 → ${dir}`)
