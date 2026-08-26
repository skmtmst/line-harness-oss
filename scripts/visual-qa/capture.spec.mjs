/**
 * 実ルートの画像を 1440px と 1920px で撮り、前回と比べる。
 *
 * ここが無い間、管理画面はローカルで1画面も開けず、PRは画面を見ないまま
 * 積まれていた。**新しい絵を描く道具ではなく、壊れたことに気づく道具**。
 *
 * 見張っているもの
 * 1. 画面がそもそも描けるか（エラー画面・空白ではないか）
 * 2. **横スクロールが出ていないか**（1440でも1920でも）
 * 3. 前回の画像と変わっていないか
 *
 * 使い方
 *   node scripts/visual-qa/mock-api.mjs &
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web dev &
 *   npx playwright test scripts/visual-qa/capture.spec.mjs
 *
 * 初回は基準の画像が無いので、撮って通す。2回目から比較する。
 */
import { test, expect } from '@playwright/test'
import { ROUTES, WIDTHS } from './routes.mjs'

const BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'

/** 画面がエラーで止まったときの文言。出ていたら失敗させる。 */
const FAILURE_TEXTS = [
  '画面を表示できませんでした',
  '店舗が選ばれていません',
  'Application error',
]

test.describe.configure({ mode: 'parallel' })

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`${width}px ${route.name}（${route.path}）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })

      // 認証後の店舗選択は毎回消される仕組みなので、消さない印を先に置く。
      // product 側は一切変えない。
      await page.addInitScript(() => {
        try {
          window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
          window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
        } catch {
          // ストレージが使えない環境では何もしない
        }
      })

      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })

      // 1. 描けているか
      const body = await page.locator('body').innerText()
      for (const bad of FAILURE_TEXTS) {
        expect(body, `${route.path} が「${bad}」で止まっている`).not.toContain(bad)
      }

      // 2. 横スクロールが出ていないか。V6共通ルール §1-8。
      //    1px の誤差は端数なので許す。2px 以上はレイアウトの破れ。
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${route.path} に横スクロールが出ている（${overflow}px）`).toBeLessThan(2)

      // 3. 前回と変わっていないか
      await expect(page).toHaveScreenshot(`${route.name}-${width}.png`, {
        fullPage: true,
        // 文字のにじみで毎回わずかに違う。0.2%までは同じとみなす。
        maxDiffPixelRatio: 0.002,
        animations: 'disabled',
      })
    })
  }
}
