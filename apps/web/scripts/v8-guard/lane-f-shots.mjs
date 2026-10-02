/*
 * レーンF 一時撮影スクリプト（コミットしない）。
 *   node apps/web/scripts/v8-guard/lane-f-shots.mjs <baseUrl> <outDir>
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { openPage } from './browser-env.mjs'

const [baseUrl, dir] = process.argv.slice(2)
if (!baseUrl || !dir) throw new Error('使い方: lane-f-shots.mjs <baseUrl> <outDir>')
mkdirSync(dir, { recursive: true })

const ROUTES = {
  affiliates: '/affiliates',
  offers: '/affiliates?tab=offers',
  approvals: '/affiliates?tab=approvals',
  payment: '/affiliates?tab=payment',
  report: '/affiliates?tab=report',
}

const browser = await chromium.launch()
let n = 0
for (const width of [1440, 1152]) {
  for (const [name, route] of Object.entries(ROUTES)) {
    const page = await openPage(browser, { baseUrl, route, width, theme: 'v8', stable: true })
    await page.screenshot({ path: join(dir, `v8-${width}-${name}.png`), fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    console.log(`${name} ${width}: 横はみ出し ${overflow}px`)
    await page.close()
    n += 1
  }
}
await browser.close()
console.log(`撮影 ${n} 枚 → ${dir}`)
