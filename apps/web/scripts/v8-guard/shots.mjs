/*
 * 7ページを 1152・1440 で撮る（時計を固定・動きを止める）。v7-pixel-diff の材料。
 *
 *   node apps/web/scripts/v8-guard/shots.mjs <baseUrl> <outDir> [v7|v8|both]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { ROUTES, openPage } from './browser-env.mjs'

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
      await page.close()
      n += 1
    }
  }
}
await browser.close()
console.log(`撮影 ${n} 枚 → ${dir}`)
