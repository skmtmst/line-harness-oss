import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const base = process.env.MAINA_BASE ?? 'http://127.0.0.1:3428'
const init = {
  'lh-admin-theme': 'v8', lh_csrf: 'visual-qa-csrf', lh_staff_role: 'owner', lh_staff_name: 'K',
  lh_staff_permissions: '[]', lh_staff_view_permissions: '[]', lh_selected_account: 'visual-qa-account', lh_auth_selection_cleared: '1',
}
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1440, 1152]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript((entries) => { for (const [key, value] of entries) localStorage.setItem(key, value) }, Object.entries(init))
    const page = await context.newPage()
    await page.goto(`${base}/tags`, { waitUntil: 'networkidle' })
    const folders = page.locator('[data-template-region="folders"]')
    if (width === 1440) {
      const boardWidth = (await folders.boundingBox()).width
      assert.equal(boardWidth, 225, 'B-7: 左の列は中身200＋左右12＋境界線1')
      const defaultWidth = await folders.evaluate((el) => {
        const saved = el.getAttribute('style'); el.removeAttribute('style')
        const width = el.getBoundingClientRect().width
        if (saved !== null) el.setAttribute('style', saved)
        return width
      })
      assert.equal(defaultWidth, 225, 'B-7: 共通の列は中身200＋左右12＋境界線1')
      const rows = folders.locator('[data-has-actions]')
      assert.ok(await rows.count(), 'フォルダ操作の見本がある')
      for (const row of await rows.all()) {
        await row.hover()
        const menu = row.locator('button[aria-haspopup="menu"]')
        assert.equal(await menu.count(), 1)
        const center = await menu.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
        assert.ok(await menu.evaluate((el, pt) => el.contains(document.elementFromPoint(pt.x, pt.y)), center), 'B-39: 件数がメニューのクリックを遮らない')
        await menu.click()
        await page.getByRole('menu').waitFor()
        await page.keyboard.press('Escape')
      }
    } else assert.equal(await folders.isVisible(), false, '狭い板ではフォルダ列を畳む')
    await page.goto(`${base}/tags?tab=fields`, { waitUntil: 'networkidle' })
    const row = page.getByRole('row').filter({ hasText: '愛犬のお名前' }).first()
    await row.waitFor()
    const before = await page.evaluate(() => window.scrollY)
    await row.locator('td').nth(1).click()
    const panel = page.locator('[data-design-part="detail-panel"]')
    await panel.waitFor()
    await panel.evaluate(async (el) => { await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))) })
    const box = await panel.boundingBox()

    assert.ok(box && box.x > width / 2 && box.x + box.width <= width, 'B-38: 詳細は右側の画面内に置く')
    assert.equal(await page.evaluate(() => window.scrollY), before, 'B-38: 開いてもページを送らない')
    assert.ok(await panel.evaluate((el) => el === document.activeElement), '詳細へフォーカスを移す')
    await page.waitForTimeout(350) // 共通の画面切り替えの絵が終わってから撮る。
    await page.screenshot({ path: `/tmp/mainA-details-${width}.png` })
    await panel.getByRole('button', { name: '閉じる', exact: true }).click()
    assert.equal(await page.evaluate(() => window.scrollY), before, '閉じてもページを送らない')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '右端へのはみ出しなし')
    console.log(JSON.stringify({ width, folderWidth: width === 1440 ? 225 : 'collapsed', panel: box, scrollY: before, result: 'pass' }))
    await context.close()
  }
} finally { await browser.close() }
