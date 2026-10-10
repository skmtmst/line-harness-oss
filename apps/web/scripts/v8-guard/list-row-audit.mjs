import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'
import { openPage, WIDTHS } from './browser-env.mjs'
import { scanListRows } from './list-row-scan.mjs'

const [baseUrl = 'http://127.0.0.1:4310', output = '/tmp/list-row-audit.json'] = process.argv.slice(2)
const map = JSON.parse(readFileSync(new URL('../../../../scripts/visual-qa/v8-design-map.json', import.meta.url)))
const routes = [...new Set(Object.values(map.boards).filter((board) => board.app !== 'liff' && /一覧/.test(board.name) && !board.state?.manual).map((board) => board.url || board.route).filter((route) => typeof route === 'string' && route.startsWith('/')))]
// 地図でまだ「一覧」と名付けられていない表も含める。
for (const route of ['/friends', '/tags', '/chats', '/automations', '/inflow-links', '/webinars', '/affiliates?tab=offers', '/booking/staff', '/nen/pets', '/nen-campaigns', '/rich-menus', '/line-notifications', '/restaurant-test/line-followup', '/staff', '/tags?tab=fields', '/tags?tab=marks', '/tags?tab=searches', '/affiliates?tab=affiliators', '/hq/templates?type=tag', '/hq/friend-attributes', '/automations?tab=actions']) if (!routes.includes(route)) routes.push(route)
const selected = process.env.LIST_ROW_ROUTES?.split(',') ?? routes
const widths = process.env.LIST_ROW_WIDTHS?.split(',').map(Number) ?? WIDTHS
const browser = await chromium.launch()
let rowCount = 0, failed = false
const results = []
try {
  for (const width of widths) for (const route of selected) {
    const page = await openPage(browser, { baseUrl, route, width, theme: 'v8', stable: true })
    try {
      const result = await page.evaluate(scanListRows)
      rowCount += result.rows
      failed ||= result.failures.length > 0
      results.push({ route, width, ...result })
      console.log(`${width} ${route}: ${result.rows}行 ${result.failures.join('・') || '合格'}`)
    } finally { await page.close() }
  }
  // わざと壊す対照。実際のブラウザで5種類すべてを拾わなければ失敗。
  const control = await browser.newPage()
  await control.setContent('<main><div data-tag-overflow style="width:10px;white-space:nowrap">長いタグ長いタグ</div><table><tbody><tr><td><span data-list-name title="名前"><i></i><span><span>名前</span><br><span>識別子</span></span></span></td><td><button>編集する</button><a style="color:#2563eb">名前</a></td></tr></tbody></table><span data-kpi-number>停止中</span></main>')
  const negative = await control.evaluate(scanListRows)
  const rules = ['B-190 タグのはみ出し', 'B-193 行の右の編集', 'B-194 名前の2行目', 'B-195 数の帯の言葉', 'B-198 表の青い文字']
  if (rules.some((rule) => !negative.failures.includes(rule))) throw new Error(`対照が見逃しました: ${JSON.stringify(negative)}`)
  console.log(`対照: ${rules.length}種類の違反を検出（合格）`)
  await control.close()
  if (rowCount === 0) throw new Error('一覧の行が一つも取れていません')
} finally { await browser.close() }
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(results, null, 2))
if (failed) process.exitCode = 1
