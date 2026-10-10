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
  await control.setContent('<div data-list-skeleton style="width:500px"><table><thead><tr data-shared-part="list-head" style="height:70px"><th>見出し</th></tr></thead><tbody><tr data-shared-part="list-row" style="height:90px"><td>名前</td></tr></tbody></table><div data-kpi-strip><div data-design-version style="height:30px">数</div></div><div data-list-toolbar style="width:10px"><button style="width:150px">操作</button></div><aside data-template-region="folders">フォルダ</aside><div data-list-pager style="width:500px"><nav style="width:100px">前へ・次へ</nav></div><div style="width:900px">はみ出し</div></div>')
  const negative = await control.evaluate(scanListSkeleton)
  const expected = ['B-178 見出し40', 'B-178 行60', 'B-178 数の帯116', 'B-178 道具のはみ出し', 'B-178 フォルダの畳み忘れ', 'B-178 ページ送りの右寄せ', 'B-178 一覧のはみ出し']
  if (expected.some((rule) => !negative.failures.includes(rule))) throw new Error(`対照の見逃し: ${JSON.stringify(negative)}`)
  console.log(`対照：${expected.length}種類の違反を検出`)
  await control.setContent('<div data-shared-part="image-frame" data-image-frame><div data-size="compact" style="width:20px;height:30px">画像</div></div><div data-sticky-layout="center" style="width:500px"><div data-sticky-actions style="width:100px">保存</div></div><div data-event-action-row style="width:10px"><div style="width:200px">すること</div></div>')
  const partControl = await control.evaluate(scanSharedSkeletonParts)
  const partExpected = ['B-178 画像の枠160×106', 'B-178 下の帯の中央操作', 'B-178 することの行のはみ出し']
  if (partExpected.some((rule) => !partControl.failures.includes(rule))) throw new Error(`3部品の対照の見逃し: ${JSON.stringify(partControl)}`)
  console.log(`3部品の対照：${partExpected.length}種類の違反を検出`)
  await control.close()
} finally { await browser.close() }
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(results, null, 2) + '\n')
if (failed) process.exitCode = 1
