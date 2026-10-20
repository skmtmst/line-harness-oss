import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'
import { openPage, WIDTHS } from './browser-env.mjs'
import { scanListSkeleton, scanSharedSkeletonParts } from './list-skeleton-scan.mjs'

const [baseUrl = 'http://127.0.0.1:4310', output = '/tmp/list-skeleton-audit.json'] = process.argv.slice(2)
const registry = JSON.parse(readFileSync(new URL('../../design/list-skeleton.json', import.meta.url)))
const routes = process.env.LIST_SKELETON_ROUTES?.split(',') ?? [...new Set(registry.boards.map((board) => board.url))]
const widths = process.env.LIST_SKELETON_WIDTHS?.split(',').map(Number) ?? WIDTHS
const browser = await chromium.launch()
const results = []
let failed = false
try {
  for (const width of widths) for (const route of routes) {
    const page = await openPage(browser, { baseUrl, route, width, theme: 'v8', stable: true })
    try {
      await page.locator('[data-list-skeleton]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
      const result = await page.evaluate(scanListSkeleton)
      if (!result.scopes) result.failures.push('B-178 一覧の型なし')
      const expectsTable = registry.boards.some((board) => board.url === route && board.layout !== 'cards')
      if (expectsTable && (!result.coverage.heads || !result.coverage.rows)) result.failures.push('B-178 表の見張り対象なし')
      failed ||= result.failures.length > 0
      results.push({ width, route, ...result })
      console.log(`${width} ${route}: ${result.failures.join('・') || '合格'}`)
    } finally { await page.close() }
  }
  for (const width of widths) for (const part of registry.parts) {
    const page = await openPage(browser, { baseUrl, route: part.url, width, theme: 'v8', stable: true })
    try {
      await page.locator(`[data-shared-part="${part.expected[0]}"]`).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
      const result = await page.evaluate(scanSharedSkeletonParts)
      for (const expected of part.expected) if (!result.parts[expected]) result.failures.push(`B-178 共通部品なし ${expected}`)
      failed ||= result.failures.length > 0
      results.push({ width, route: part.url, ...result })
      console.log(`${width} ${part.url}: ${result.failures.join('・') || '合格'}`)
    } finally { await page.close() }
  }
  const control = await browser.newPage()
  await control.setContent('<div data-list-skeleton style="width:500px"><div data-list-toolbar style="width:10px"><button style="width:150px">操作</button></div><div style="width:900px">はみ出し</div></div>')
  const negative = await control.evaluate(scanListSkeleton)
  for (const rule of ['B-178 道具のはみ出し', 'B-178 一覧のはみ出し']) if (!negative.failures.includes(rule)) throw new Error(`対照の見逃し: ${rule}`)
  await control.setContent('<div data-event-action-row style="width:10px"><div style="width:200px">すること</div></div>')
  if (!(await control.evaluate(scanSharedSkeletonParts)).failures.includes('B-178 することの行のはみ出し')) throw new Error('操作欄のはみ出しを見逃した')
  await control.close()
} finally { await browser.close() }
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(results, null, 2) + '\n')
if (failed) process.exitCode = 1
