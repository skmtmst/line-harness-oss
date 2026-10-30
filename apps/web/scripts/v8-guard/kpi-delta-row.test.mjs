import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { openPage } from './browser-env.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'
import { styleDashboardMock } from '../../../../scripts/visual-qa/style-dashboard-mock.mjs'

/* 数の帯：増減の札は数字の行の右に1行で収め、カードの高さをそろえる。 */
function bandState() {
  const cards = [...document.querySelectorAll('[data-kpi-strip][data-kpi-presentation="band"] > [data-design-version]')]
  return cards.map((card) => {
    const row = card.querySelector('[data-kpi-fit]')
    const value = row?.querySelector('p')
    const chip = card.querySelector('[data-kpi-delta-slot] > *')
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height } }
    return { card: r(card), value: value ? r(value) : null, chip: chip ? r(chip) : null }
  })
}

for (const width of [1152, 1440]) test(`店のダッシュボードの数の帯は札を数字の行に置き高さをそろえる ${width}`, async () => {
  styleDashboardMock('PUT', '/api/dashboard/style', new URLSearchParams(), { style: 'salon' })
  const browser = await connectGuardBrowser()
  let page
  try {
    const adapter = { newPage: async options => { const page = await browser.newPage(options); await stubApi(page, mockFetch); return page } }
    page = await openPage(adapter, { baseUrl: process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310', route: '/', width, stable: true, requireSuccess: true })
    await page.locator('[data-kpi-strip][data-kpi-presentation="band"]').first().waitFor()
    const check = (cards) => {
      assert.ok(cards.length > 0, '数の帯のカードがある')
      for (const [i, card] of cards.entries()) {
        if (!card.chip) continue
        assert.ok(card.chip.top >= card.value.top - 1 && card.chip.top < card.value.bottom,
          `札は数字の行の中にある（カード${i}：札の上 ${card.chip.top}、数字行 ${card.value.top}〜${card.value.bottom}）`)
      }
      const heights = cards.map((card) => card.card.height)
      assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `カードの高さがそろう（${heights.join(',')}）`)
    }
    check(await page.evaluate(bandState))
    /* わざと札を次の行に落とすと赤になる */
    const fault = await page.evaluate(() => {
      const slot = document.querySelector('[data-kpi-delta-slot]')
      slot.style.setProperty('flex', '1 1 100%')
      const cards = [...document.querySelectorAll('[data-kpi-strip][data-kpi-presentation="band"] > [data-design-version]')].map((card) => {
        const value = card.querySelector('[data-kpi-fit] p')
        const c = card.querySelector('[data-kpi-delta-slot] > *')
        const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height } }
        return { card: r(card), value: value ? r(value) : null, chip: c ? r(c) : null }
      })
      const bad = cards.some((card) => card.chip && !(card.chip.top >= card.value.top - 1 && card.chip.top < card.value.bottom))
      slot.style.removeProperty('flex')
      return bad
    })
    assert.equal(fault, true, '札を落とすと検知する')
  } finally { await page?.close(); await browser.close(); styleDashboardMock('PUT', '/api/dashboard/style', new URLSearchParams(), { style: 'standard' }) }
})
