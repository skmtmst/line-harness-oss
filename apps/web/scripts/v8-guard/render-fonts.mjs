/** Measure actual React SSR output in Chromium, outside happy-dom globals. */
import { chromium } from '@playwright/test'
let input = ''
for await (const chunk of process.stdin) input += chunk
const { html, selector, widths } = JSON.parse(input)
const browser = await chromium.launch()
const results = []
try {
  const page = await browser.newPage()
  await page.route('**/*', route => route.abort())
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(html)
    results.push({ width, sizes: await page.locator(selector).evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize))) })
  }
} finally { await browser.close() }
process.stdout.write(JSON.stringify(results))
