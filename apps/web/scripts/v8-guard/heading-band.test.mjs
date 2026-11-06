import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'
import scan from './heading-band-browser.mjs'

test('閲覧帯は見出しと操作の行の下で頭いっぱいにあり、題の列に戻すと検出して復元する', async () => {
  const browser = await connectGuardBrowser()
  try {
    for (const width of [1152, 1440]) {
      const baseUrl = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310'
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      try {
        await stubApi(page, mockFetch)
        await page.addInitScript(() => {
          for (const [key, value] of Object.entries({ lh_csrf: 'visual-qa-csrf', lh_staff_role: 'owner', lh_staff_name: 'K', lh_staff_permissions: '[]', lh_staff_view_permissions: '[]', lh_selected_account: 'visual-qa-account', lh_auth_selection_cleared: '1' })) localStorage.setItem(key, value)
        })
        const open = async () => {
          const response = await page.goto(new URL('/visual-qa/heading-band', baseUrl).href)
          assert.ok(response?.ok(), 'built heading-band guard must exist')
          for (const kind of ['list', 'restaurant']) {
            const header = page.locator(`[data-page-template="${kind}"] header[data-template-region="heading"]`)
            await header.locator('h1').first().waitFor()
            const band = header.locator('[data-read-only-notice]')
            await band.waitFor()
            assert.equal(await band.count(), 1)
          }
        }
        await open()
        assert.deepEqual(await page.evaluate(scan), [])
        const widths = await page.locator('[data-page-template="list"] header [data-read-only-notice], [data-page-template="restaurant"] header [data-read-only-notice]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))
        const fault = await page.evaluate(() => {
          const moved = []
          for (const head of document.querySelectorAll('[data-page-template="list"] header[data-template-region="heading"], [data-page-template="restaurant"] header[data-template-region="heading"]')) {
            const wrap = head.querySelector(':scope > [data-template-region="notice"]')
            const title = head.querySelector('h1')
            let column = title
            while (column.parentElement !== head) column = column.parentElement
            const before = wrap.getBoundingClientRect().width
            column.append(wrap)
            moved.push({ before, after: wrap.getBoundingClientRect().width })
          }
          return moved
        })
        assert.equal(fault.length, 2)
        for (const move of fault) assert.ok(move.after < move.before - 10, JSON.stringify(move))
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const faultFindings = await page.evaluate(scan)
        assert.equal(faultFindings.filter(finding => finding.kind === 'heading-band-inset').length, 2, JSON.stringify(faultFindings))
        await open()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert.deepEqual(await page.evaluate(scan), [])
        console.log(JSON.stringify({ width, bandWidths: widths, faultWidths: fault.map(move => move.after), faultKinds: faultFindings.map(finding => finding.kind), restored: true }))
      } finally { await page.close() }
    }
  } finally { await browser.close() }
})
