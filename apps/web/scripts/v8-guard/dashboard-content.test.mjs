import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { mockFetch } from './mock-local.mjs'
import { stubApi } from './speed-budget.mjs'
import { trackPendingApiRequests, waitForNavigationContent } from './navigation-content-ready.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { styleDashboardMock } from '../../../../scripts/visual-qa/style-dashboard-mock.mjs'

const base = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310', output = process.env.DASHBOARD_ARTIFACT_DIR || process.env.V8_GUARD_ARTIFACT_DIR || '/tmp/v8-guard/dashboard-content'
const styles = process.env.DASHBOARD_STYLES?.split(',') ?? ['standard', 'ec', 'restaurant', 'salon', 'consult', 'lesson']
const delays = process.env.DASHBOARD_DELAYS?.split(',').map(Number) ?? [600]
assert.ok(base && output)
mkdirSync(output, { recursive: true })
const rows = []
after(() => writeFileSync(join(output, 'summary.json'), JSON.stringify(rows, null, 2)))

for (const width of [1152, 1440]) for (const delay of delays) for (const style of styles) test(`${style} ${width} ${delay}`, async () => {
  styleDashboardMock('PUT', '/api/dashboard/style', new URLSearchParams(), { style })
  const browser = await connectGuardBrowser()
  const dir = join(output, `${style}-${width}-${delay}`)
  mkdirSync(dir, { recursive: true })
  const context = await browser.newContext({ viewport: { width, height: 1080 }, locale: 'ja-JP', ...(process.env.V8_GUARD_VIDEO === '1' ? { recordVideo: { dir: join(dir, 'video'), size: { width, height: 1080 } } } : {}) })
  const page = await context.newPage(), pending = trackPendingApiRequests(page), errors = [], requests = []
  const started = Date.now()
  let failure = null, guidanceVisible = false
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value) }, PARITY_INIT)
  await page.addInitScript(() => {
    window.dashboardFrames = []
    const record = () => {
      if (window.dashboardFramesStopped) return
      const main = document.querySelector('main'), metric = main?.querySelector('[data-design="TodayTasks"], [data-style-dashboard]')
      const r = metric && getComputedStyle(metric).visibility !== 'hidden' && !metric.closest('[inert],[aria-hidden="true"]') ? metric.getBoundingClientRect() : null
      window.dashboardFrames.push({ t: performance.now(), title: document.title, headings: [...(main?.querySelectorAll('h1') ?? [])].map(node => node.textContent), y: r?.width > 0 && r?.height > 0 ? r.y : null, busy: Boolean(main?.querySelector('[aria-busy="true"]')) })
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
  if (process.env.V8_GUARD_DASHBOARD_FAULT === '1') await page.addInitScript(() => {
    new MutationObserver(() => {
      for (const content of document.querySelectorAll('main [data-pending][inert]')) {
        content.removeAttribute('data-pending')
        content.removeAttribute('inert')
        content.removeAttribute('aria-hidden')
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pending'] })
  })
  await stubApi(page, async (method, path) => {
    const url = new URL(path, base)
    const timing = { method, path: url.pathname, start: Date.now() - started }
    if (url.pathname === '/api/getting-started') await new Promise(done => setTimeout(done, delay))
    const response = await mockFetch(method, path)
    if (method === 'GET' && url.pathname === '/api/dashboard/style') {
      const body = JSON.parse(response.body)
      // 選択済みの標準も含む、設定を終えた各スタイルのホームを確認する。
      body.data.styleSelected = true
      body.data.styleMode = 'configured'
      response.body = JSON.stringify(body)
    }
    requests.push({ ...timing, end: Date.now() - started })
    return response
  })
  try {
    const response = await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    assert.ok(response?.ok())
    await page.waitForTimeout(100)
    await page.screenshot({ path: join(dir, 'early.png') })
    await waitForNavigationContent(page, pending)
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(dir, 'loaded.png') })
    const frames = await page.evaluate(() => { window.dashboardFramesStopped = true; return window.dashboardFrames })
    guidanceVisible = await page.getByRole('region', { name: 'はじめにやること', exact: true }).isVisible()
    assert.ok(guidanceVisible, '未完の案内を実際に表示して揺れを確かめる')
    const positions = frames.filter(frame => frame.y !== null).map(frame => frame.y)
    assert.ok(positions.length > 1, '実際のダッシュボードの帯が表示された')
    const shift = Math.max(...positions) - Math.min(...positions)
    assert.ok(shift <= 8, `案内の後挿入で本文が動いた: ${shift}px`)
    assert.equal((await page.locator('main h1').first().innerText()).trim(), 'ダッシュボード')
    if (style === 'restaurant' && delay === 600) {
      await page.evaluate(() => {
        window.dateReturnedToPending = false
        window.datePendingObserver = new MutationObserver(() => {
          if (document.querySelector('main [data-pending][inert]')) window.dateReturnedToPending = true
        })
        window.datePendingObserver.observe(document.querySelector('main'), { childList: true, subtree: true, attributes: true, attributeFilter: ['inert', 'data-pending'] })
      })
      const date = page.locator('main button[data-input-field][aria-haspopup="dialog"]').first()
      const previous = await date.getAttribute('title')
      await date.click()
      await page.getByRole('dialog', { name: '日付を選ぶ', exact: true }).getByRole('button', { name: /^\d{4}年/ }).first().click()
      assert.notEqual(await date.getAttribute('title'), previous, '別の日付を選んだ')
      assert.equal(await page.locator('main [data-pending][inert]').count(), 0, '日付では初回の待機へ戻らない')
      await waitForNavigationContent(page, pending)
      assert.equal(await page.evaluate(() => { window.datePendingObserver.disconnect(); return window.dateReturnedToPending }), false, '日付の取得中も初回の待機へ戻らない')
      await page.screenshot({ path: join(dir, 'date-changed.png') })
      await page.getByRole('button', { name: 'アカウントを切り替える', exact: true }).click()
      const choices = await page.getByRole('menuitemradio').evaluateAll(elements => elements.map((element, index) => ({ index, selected: element.getAttribute('aria-checked') === 'true', disabled: element.getAttribute('aria-disabled') === 'true' })))
      const next = choices.find(choice => !choice.selected && !choice.disabled)
      assert.ok(next, '別の店舗を選べる')
      await page.getByRole('menuitemradio').nth(next.index).click()
      await page.locator('main [data-pending][inert]').waitFor({ state: 'attached', timeout: 5000 })
      await page.screenshot({ path: join(dir, 'account-pending.png') })
      await waitForNavigationContent(page, pending)
      assert.equal(await page.locator('main [data-pending][inert]').count(), 0, '店舗を替えてから読み終えた')
      await page.screenshot({ path: join(dir, 'account-ready.png') })
    }
    assert.deepEqual(errors, [])
  } catch (error) { failure = error.stack ?? String(error); throw error }
  finally {
    const frames = await page.evaluate(() => window.dashboardFrames ?? []).catch(() => [])
    const positions = frames.filter(frame => frame.y !== null).map(frame => frame.y)
    const row = { style, width, delay, guidanceVisible, fault: process.env.V8_GUARD_DASHBOARD_FAULT === '1', frames: frames.length, shift: positions.length ? Math.max(...positions) - Math.min(...positions) : null, errors, requests, failure }
    rows.push(row)
    writeFileSync(join(dir, 'frames.json'), JSON.stringify({ ...row, samples: frames }))
    try {
      await context.close()
      if (process.env.V8_GUARD_VIDEO === '1') {
        const file = join(dir, 'video/navigation.webm')
        await page.video().saveAs(file)
        assert.ok(statSync(file).size > 0)
      }
    } finally { await browser.close() }
  }
})
