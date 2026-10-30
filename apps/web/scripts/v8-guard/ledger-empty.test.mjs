import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'

const base = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4311'
const output = process.env.LEDGER_SHOTS

test('予約台帳は卓なし・空き卓・予約ありを区別し、空き卓から予約へ進める', async () => {
  const browser = await connectGuardBrowser()
  try {
    if (output) await mkdir(output, { recursive: true })
    for (const width of [1440, 1152]) {
      for (const state of ['no-tables', 'no-reservations', 'reserved']) {
        const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
        try {
          await page.addInitScript(() => {
            const NativeDate = Date
            window.Date = class extends NativeDate {
              constructor(...args) { super(...(args.length ? args : ['2026-10-01T03:00:00.000Z'])) }
              static now() { return new NativeDate('2026-10-01T03:00:00.000Z').getTime() }
            }
            for (const [key, value] of Object.entries({ lh_csrf: 'visual-qa-csrf', lh_staff_role: 'owner', lh_staff_name: 'K', lh_staff_permissions: '[]', lh_staff_view_permissions: '[]', lh_selected_account: 'visual-qa-account', lh_auth_selection_cleared: '1' })) localStorage.setItem(key, value)
          })
          await page.route('**/api/restaurant-test/**', async route => {
            const response = await route.fetch()
            const body = await response.json()
            const path = new URL(route.request().url()).pathname
            if (state !== 'reserved' && path.endsWith('/snapshot')) {
              body.data.reservations = []
              body.data.reservationTotal = 0
              if (state === 'no-tables') body.data.tables = []
            }
            if (state !== 'reserved' && path.endsWith('/reservations/day')) body.data.reservations = []
            if (state === 'no-tables' && path.endsWith('/floors')) body.data = body.data.map(floor => ({ ...floor, tables: [] }))
            await route.fulfill({ response, json: body })
          })
          await page.goto(`${base}/restaurant-test/reservations`, { waitUntil: 'networkidle' })
          await page.locator('[data-reservation-board]').waitFor()
          await page.evaluate(() => document.fonts.ready)
          if (state === 'no-tables') {
            await page.getByText('卓がまだ設定されていません', { exact: true }).waitFor()
            assert.equal(await page.getByRole('link', { name: '座席・卓を設定する', exact: true }).getAttribute('href'), '/restaurant-test/tables')
          } else if (state === 'no-reservations') {
            const slot = page.getByRole('button', { name: /T1 2名 18:00に予約を入れる/ })
            await slot.focus()
            await page.waitForFunction(() => document.activeElement?.hasAttribute('data-booking-add') && getComputedStyle(document.activeElement).opacity === '1')
            assert.equal(await slot.evaluate(node => getComputedStyle(node).opacity), '1')
            await slot.blur()
            await slot.hover()
            await page.waitForFunction(() => [...document.querySelectorAll('[data-booking-add]')].some(node => node.matches(':hover') && getComputedStyle(node).opacity === '1'))
            assert.equal(await slot.evaluate(node => getComputedStyle(node).opacity), '1')
          } else assert.ok(await page.locator('[data-booking-state]').count() > 0)
          const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, width: innerWidth }))
          assert.ok(size.content <= size.width, `${state}/${width}: horizontal overflow`)
          if (output) await page.screenshot({ path: resolve(output, `${state}-${width}.png`), fullPage: true })
          if (state === 'no-reservations') {
            await page.getByRole('button', { name: /T1 2名 18:00に予約を入れる/ }).click()
            await page.getByRole('heading', { name: '何を入れますか' }).waitFor()
            assert.equal(await page.getByRole('button', { name: '18:00', exact: true }).getAttribute('aria-pressed'), 'true')
            assert.equal(await page.locator('button').filter({ hasText: 'T1・空き' }).getAttribute('aria-pressed'), 'true')
          }
        } finally { await page.close() }
      }
    }
  } finally { await browser.close() }
})
