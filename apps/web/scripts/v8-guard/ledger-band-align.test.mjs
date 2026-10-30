import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './ledger-band-align-browser.mjs'

/* 予約台帳の数の帯：左右の端を下の段（盤＋右の列）と±2pxで合わせる。 */
test('予約台帳の数の帯の左右端は下の段と±2pxで一致する', async () => {
  const browser = await connectGuardBrowser()
  try {
    for (const width of [1152, 1440]) {
      const baseUrl = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310'
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      try {
        await page.addInitScript(() => {
          for (const [key, value] of Object.entries({ lh_csrf: 'visual-qa-csrf', lh_staff_role: 'owner', lh_staff_name: 'K', lh_staff_permissions: '[]', lh_staff_view_permissions: '[]', lh_selected_account: 'visual-qa-account', lh_auth_selection_cleared: '1' })) localStorage.setItem(key, value)
        })
        const response = await page.goto(new URL('/restaurant-test/reservations', baseUrl).href, { waitUntil: 'domcontentloaded' })
        assert.ok(response?.ok(), `built ledger page must exist (${width})`)
        await page.getByRole('heading', { name: '予約台帳' }).first().waitFor()
        await page.locator('[data-shared-part="kpi-band"]').first().waitFor()
        await page.locator('[role="region"][aria-label$="の時間×卓"]').first().waitFor()
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(1500)
        const m = await page.evaluate(scan)
        assert.ok(!m.error, `${width}: ${m.error}`)
        assert.ok(Math.abs(m.dLeft) <= 2, `${width}: left drift ${m.dLeft} (band ${m.bandLeft} / lower ${m.lowerLeft})`)
        assert.ok(Math.abs(m.dRight) <= 2, `${width}: right drift ${m.dRight} (band ${m.bandRight} / lower ${m.lowerRight})`)
        /* 故障対照：帯を内側に寄せると、本判定と同じ物差しで検出する。 */
        const fault = await page.evaluate(async () => {
          for (let i = 0; i < 20; i++) {
            const band = document.querySelector('[data-shared-part="kpi-band"]')
            band.style.setProperty('margin-inline', '24px', 'important')
            await new Promise((resolve) => setTimeout(resolve, 100))
            const again = document.querySelector('[data-shared-part="kpi-band"]')
            if (again === band && getComputedStyle(band).marginInlineStart === '24px') break
            if (i === 19) return { dLeft: 0, dRight: 0, stuck: false }
          }
          const band = document.querySelector('[data-shared-part="kpi-band"]').getBoundingClientRect()
          const board = document.querySelector('[role="region"][aria-label$="の時間×卓"]').getBoundingClientRect()
          const nextCard = document.querySelector('[aria-labelledby="rs-next-title"]')
          const side = nextCard ? nextCard.parentElement : null
          let rightRef = board.right
          if (side) {
            const sideRect = side.getBoundingClientRect()
            if (sideRect.width > 0 && getComputedStyle(side).display !== 'none') rightRef = sideRect.right
          }
          return { dLeft: band.left - board.left, dRight: band.right - rightRef, stuck: true }
        })
        assert.ok(fault.stuck, `${width}: fault must stick`)
        assert.ok(Math.abs(fault.dLeft) > 2 || Math.abs(fault.dRight) > 2, `${width}: fault must drift`)
      } finally { await page.close() }
    }
  } finally { await browser.close() }
})
