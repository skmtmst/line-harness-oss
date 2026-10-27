import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { openPage } from './browser-env.mjs'

const [baseUrl, outDir, apiUrl] = process.argv.slice(2)
if (!baseUrl || !outDir || !apiUrl) throw new Error('使い方: tone-after-shots.mjs <baseUrl> <outDir> <偽APIのURL>')
// ダッシュボードは使い方のスタイルで中身が変わるので、6 つ全部を撮る。
const dashboardStyles = ['standard', 'restaurant', 'salon', 'consult', 'lesson', 'ec']
const routes = {
  ...Object.fromEntries(dashboardStyles.map(style => [`dashboard-${style}`, '/'])),
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
    const style = name.startsWith('dashboard-') ? name.slice('dashboard-'.length) : 'standard'
    const response = await fetch(new URL('/api/dashboard/style?account_id=visual-qa-account', apiUrl), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ style }),
    })
    if (!response.ok) throw new Error(`dashboard style fixture failed: ${style} ${response.status}`)
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
    const cardEdgeIssues = await page.locator('[data-design-part=\"card\"]:not([data-card-frame=\"ring\"]):not([data-card-surface=\"bordered\"])').evaluateAll(elements => elements.flatMap(element => {
      const style = getComputedStyle(element)
      const borderWidths = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].map(key => Number.parseFloat(style[key]) || 0)
      const borderColors = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'].map(key => style[key])
      const visibleBorder = borderWidths.some((width, index) => width > 0 && borderColors[index] !== 'rgba(0, 0, 0, 0)' && borderColors[index] !== 'transparent')
      const outline = Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none' && style.outlineColor !== 'rgba(0, 0, 0, 0)' && style.outlineColor !== 'transparent'
      const shadowEdge = /0px\s+0px\s+0px\s+1px/.test(style.boxShadow)
      return visibleBorder || outline || shadowEdge ? [`Card edge ${visibleBorder ? 'border ' : ''}${outline ? 'outline ' : ''}${shadowEdge ? '1px shadow' : ''}`] : []
    }))
    const actionRowIssues = await page.locator('[data-card-action-row]').evaluateAll(elements => elements.flatMap(element => {
      const style = getComputedStyle(element)
      const columns = style.gridTemplateColumns.split(' ').map(Number)
      return style.display === 'grid' && columns.length === 2 && Math.abs(columns[0] - columns[1]) < 1 ? [] : [`CardActionRow ${style.display} ${style.gridTemplateColumns}`]
    }))
    if (shapeIssues.length || firstLineIssues.length || actionRowIssues.length || cardEdgeIssues.length) throw new Error([...shapeIssues, ...firstLineIssues, ...actionRowIssues, ...cardEdgeIssues].join('\n'))
    await page.screenshot({ path: join(outDir, `${name}-${width}.png`) })
    await page.close()
  }
}
await browser.close()
console.log(`撮影 ${Object.keys(routes).length * 2} 枚 → ${outDir}`)
