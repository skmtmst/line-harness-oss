import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { openPage } from './browser-env.mjs'

const [baseUrl, outDir] = process.argv.slice(2)
if (!baseUrl || !outDir) throw new Error('使い方: tone-after-shots.mjs <baseUrl> <outDir>')
const routes = {
  dashboard: '/',
  broadcasts: '/broadcasts',
  tags: '/tags',
  inbox: '/chats',
  accounts: '/accounts',
  settings: '/settings',
  login: '/login',
}
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
for (const width of [1152, 1440]) {
  for (const [name, route] of Object.entries(routes)) {
    const page = await openPage(browser, { baseUrl, route, width, stable: true, requireSuccess: true })
    // Hide only the Next.js development portal; it is not part of the product UI.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.waitForTimeout(300)
    await page.locator('nextjs-portal').evaluateAll(elements => elements.forEach(element => element.remove()))
    const shapeIssues = await page.locator('[data-notice-dot]').evaluateAll(elements => elements.flatMap(element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return rect.width === 8 && rect.height === 8 && style.borderRadius !== '0px' && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? [] : [`Notice dot ${rect.width}x${rect.height} ${style.borderRadius} ${style.backgroundColor}`]
    }))
    const firstLineIssues = await page.locator('[data-notice-dot]').evaluateAll(elements => elements.flatMap(element => {
      const message = element.nextElementSibling
      const heading = message?.querySelector('[class*="heading"]')
      if (!heading) return []
      const range = document.createRange()
      range.selectNodeContents(heading)
      const firstLine = range.getClientRects()[0]
      if (!firstLine) return []
      const dot = element.getBoundingClientRect()
      const dotCenter = dot.top + dot.height / 2
      const lineCenter = firstLine.top + firstLine.height / 2
      return Math.abs(dotCenter - lineCenter) <= 1 ? [] : [`Notice dot/title center delta ${Math.abs(dotCenter - lineCenter).toFixed(1)}px`]
    }))
    const actionRowIssues = await page.locator('[data-card-action-row]').evaluateAll(elements => elements.flatMap(element => {
      const style = getComputedStyle(element)
      const columns = style.gridTemplateColumns.split(' ').map(Number)
      return style.display === 'grid' && columns.length === 2 && Math.abs(columns[0] - columns[1]) < 1 ? [] : [`CardActionRow ${style.display} ${style.gridTemplateColumns}`]
    }))
    if (shapeIssues.length || firstLineIssues.length || actionRowIssues.length) throw new Error([...shapeIssues, ...firstLineIssues, ...actionRowIssues].join('\n'))
    await page.screenshot({ path: join(outDir, `${name}-${width}.png`) })
    await page.close()
  }
}
await browser.close()
console.log(`撮影 14 枚 → ${outDir}`)
