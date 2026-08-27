/**
 * 画面が落ちる原因を、口の返事の形から当てる。
 *
 * 画面が「もう一度試す」になるとき、**たいていは実装ではなく固定データの
 * 形が違う。** 一覧の口の既定（`{items,total,page,limit}`）が、配列や
 * 別の形を待っている画面へ返るとそこで落ちる。
 *
 * どの口が `{items,total}` の既定のまま返っているかを並べれば、直す先が
 * すぐ分かる。1つずつエラーを追うより速い。
 *
 *   node scripts/visual-qa/diagnose.mjs /scenarios/detail?id=scenario-0
 */
import { chromium } from '@playwright/test'

const BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'
const path = process.argv[2]
if (!path) {
  console.error('見るルートを渡してください（例: /scenarios/detail?id=scenario-0）')
  process.exit(1)
}

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1920, height: 1200 },
  timezoneId: 'Asia/Tokyo',
  locale: 'ja-JP',
})
await page.addInitScript(() => {
  try {
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
  } catch { /* ストレージが使えない環境では何もしない */ }
})

const errors = []
page.on('pageerror', (error) => errors.push(String(error).split('\n')[0]))

const seen = []
page.on('response', async (response) => {
  const url = response.url()
  if (!url.includes('/api/')) return
  const endpoint = url.split('/api/')[1].split('?')[0]
  let shape = '(読めず)'
  try {
    const body = await response.json()
    const data = body?.data
    if (Array.isArray(data)) shape = `配列 ${data.length}件`
    else if (data && typeof data === 'object') {
      const keys = Object.keys(data)
      const isDefault = keys.length === 4 && ['items', 'total', 'page', 'limit'].every((k) => keys.includes(k))
      shape = isDefault ? '★ 一覧の既定 {items,total,page,limit}' : `{${keys.slice(0, 6).join(',')}}`
    } else shape = String(data)
  } catch { /* JSON でない返事は形を見ない */ }
  seen.push(`${response.status()} /api/${endpoint}  ${shape}`)
})

await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
await page.waitForTimeout(5_000)

const url = new URL(page.url())
console.log(`${path} → ${url.pathname}${url.search}`)
const body = await page.locator('body').innerText()
const broken = ['画面を表示できませんでした', 'もう一度試す'].some((t) => body.includes(t))
console.log(broken ? '**落ちている**' : '描けている')
if (errors.length) console.log('エラー: ' + [...new Set(errors)].join(' | '))
console.log('\n口の返事:')
/*
  ★ が付いたものが疑わしい。**一覧の既定のまま返っている口**で、
  画面が配列や別の形を待っていると、そこで落ちる。
*/
for (const line of [...new Set(seen)]) console.log('  ' + line)

await browser.close()
