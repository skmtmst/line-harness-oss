// 先に v7-preservation.manual.tsx で基準と現在のSSR見本を作る。
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import fs from 'node:fs/promises'
const base = process.argv[2] ?? 'http://127.0.0.1:3123'
const browser = await chromium.launch()
const shots = []
for (const name of ['before', 'after']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce', deviceScaleFactor: 1 })
  await page.route(`${base}/v7-${name}.html`, route => fs.readFile(`/tmp/lh-cards-v7-${name}.html`, 'utf8').then(body => route.fulfill({ contentType: 'text/html', body })))
  await page.goto(`${base}/v7-${name}.html`)
  await page.evaluate(() => document.fonts.ready)
  shots.push(PNG.sync.read(await page.locator('.v7-fixtures').screenshot({ animations: 'disabled' })))
  await page.close()
}
const [before, after] = shots
let pixels = 0
if (before.width !== after.width || before.height !== after.height) throw new Error('V7の大きさが変わっています')
for (let i = 0; i < before.data.length; i += 4) {
  if ([0,1,2,3].some(channel => before.data[i + channel] !== after.data[i + channel])) pixels++
}
const combined = new PNG({ width: before.width * 2 + 48, height: before.height + 32 })
combined.data.fill(255)
PNG.bitblt(before, combined, 0, 0, before.width, before.height, 16, 16)
PNG.bitblt(after, combined, 0, 0, after.width, after.height, before.width + 32, 16)
await fs.writeFile('design/v8/parts-check/v7-cards.png', PNG.sync.write(combined))
await fs.writeFile('design/v8/parts-check/v7-cards.json', JSON.stringify({ baseSha: '4b1cd841318a66b265a6fb64dbe25baa4106b1b6', viewport: 1440, width: before.width, height: before.height, changedPixels: pixels, scope: '選ぶ・チェック・成功/失敗の知らせ・閉じた補足・案内・空・窓・LINE枠', result: pixels === 0 ? '合格' : '要修正' }, null, 2))
console.log(`V7の変更画素：${pixels}`)
await browser.close()
if (pixels) process.exitCode = 1
