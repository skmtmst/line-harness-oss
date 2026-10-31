import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { mockFetch } from './mock-local.mjs'
import { stubApi } from './speed-budget.mjs'
import { trackPendingApiRequests, waitForNavigationContent } from './navigation-content-ready.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { styleDashboardMock } from '../../../../scripts/visual-qa/style-dashboard-mock.mjs'

const base = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310'
const output = process.env.V8_GUARD_ARTIFACT_DIR || '/tmp/v8-guard/canonical-route'
const delays = process.env.CANONICAL_DELAYS?.split(',').map(Number) ?? [0, 600]
const cases = [
  ...['affiliates', 'offers', 'approvals', 'payment', 'points', 'report'].map(tab => ({ from: `/conversions?tab=${tab}&q=春#rows`, to: `/affiliates?tab=${tab}&q=春#rows` })),
  { from: '/conversions?tab=invalid&pointId=cp-1', to: '/affiliates?tab=points&pointId=cp-1' },
  { from: '/conversions', to: '/affiliates?tab=points' },
  { from: '/affiliate-offers?q=春#rows', to: '/affiliates?q=春&tab=offers#rows' },
  { from: '/settings/features?q=春#list', to: '/settings?q=春#list' },
  { from: '/auto-replies/publish?id=ar-1', to: '/auto-replies/edit?id=ar-1&step=priority' },
  { from: '/restaurant-test', to: '/hq', server: true },
  { from: '/restaurant-test/stores', to: '/hq', server: true },
  { from: '/ops', to: '/ops/tenants', server: true },
]
const rows = []
mkdirSync(output, { recursive: true })
after(() => writeFileSync(join(output, 'summary.json'), JSON.stringify(rows, null, 2)))
for (const width of [1152, 1440]) for (const delay of delays) test(`正規の入口 ${width} API+${delay}`, async () => {
  styleDashboardMock('PUT', '/api/dashboard/style', new URLSearchParams(), { style: 'ec' })
  const browser = await connectGuardBrowser(), dir = join(output, `${width}-${delay}`)
  mkdirSync(dir, { recursive: true })
  const context = await browser.newContext({ viewport: { width, height: 1080 }, locale: 'ja-JP', ...(process.env.V8_GUARD_VIDEO === '1' ? { recordVideo: { dir: join(dir, 'video'), size: { width, height: 1080 } } } : {}) })
  const page = await context.newPage(), pending = trackPendingApiRequests(page), errors = [], navigations = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()) })
  await page.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value) }, PARITY_INIT)
  await page.addInitScript(() => {
    window.routeFrames = []
    const record = () => {
      if (document.readyState !== 'loading') window.routeFrames.push({ t: performance.now(), path: location.pathname, title: document.title, titles: document.head.querySelectorAll('title').length, crumb: document.querySelector('header nav[aria-label="パンくず"]')?.textContent ?? '', h1: [...document.querySelectorAll('main h1')].map(node => node.textContent) })
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
  if (process.env.V8_GUARD_CANONICAL_FAULT === '1') await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      if (location.pathname === '/conversions') new MutationObserver(() => {
        const title = document.head.querySelector('title')
        if (title && title.textContent !== 'コンバージョン | musubo') title.textContent = 'コンバージョン | musubo'
      }).observe(document.head, { childList: true, subtree: true, characterData: true })
    })
  })
  await stubApi(page, async (method, path) => {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    const response = await mockFetch(method, path)
    if (new URL(path, base).pathname === '/api/staff/me') {
      const body = JSON.parse(response.body)
      if (body.data) body.data.accountScope = 'all'
      response.body = JSON.stringify(body)
    }
    return response
  })
  async function observe(entry, action, direct = true) {
    const id = String(rows.length + 1).padStart(3, '0'), beforeNav = navigations.length, beforeError = errors.length
    let failure = null
    await page.evaluate(() => { window.routeFrames = [] }).catch(() => {})
    try {
      await action()
      const expected = new URL(entry.to, base)
      await page.waitForURL(url => url.pathname === expected.pathname)
      await waitForNavigationContent(page, pending)
      await page.waitForTimeout(250)
      const actual = new URL(page.url())
      assert.equal(actual.pathname, expected.pathname)
      for (const [key, value] of expected.searchParams) assert.equal(actual.searchParams.get(key), value)
      const frames = await page.evaluate(() => window.routeFrames)
      assert.ok(frames.length > 1)
      assert.ok(frames.every(frame => frame.titles === 1))
      if (expected.pathname === '/affiliates') {
        assert.equal(await page.title(), '成果とアフィリエイト | musubo')
        assert.ok(frames.every(frame => !frame.title.includes('コンバージョン') && !frame.crumb.includes('コンバージョン')), '転送の途中に別の題が出た')
      }
      assert.equal(actual.hash, expected.hash)
      if (!direct) assert.ok(frames.every(frame => frame.path !== '/conversions'), '内部リンクは互換入口を挟まない')
      const paths = navigations.slice(beforeNav).map(url => new URL(url).pathname)
      assert.ok(paths.filter(path => path !== new URL(entry.from, base).pathname).every(path => path === expected.pathname), `余分な転送: ${paths}`)
      assert.deepEqual(errors.slice(beforeError), [])
    } catch (error) { failure = error.stack ?? String(error); throw error }
    finally {
      const samples = await page.evaluate(() => window.routeFrames ?? []).catch(() => [])
      const row = { id, width, delay, ...entry, direct, url: page.url(), frames: samples.length, navigations: navigations.slice(beforeNav), failure, errors: errors.slice(beforeError) }
      rows.push(row)
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...row, samples }))
      await page.screenshot({ path: join(dir, `${id}.png`) }).catch(() => {})
    }
  }
  try {
    for (const entry of process.env.CANONICAL_PROBE === '1' ? cases.slice(0, 1) : cases) {
      await page.goto(base + '/templates', { waitUntil: 'domcontentloaded' })
      await waitForNavigationContent(page, pending)
      await observe(entry, async () => {
        const response = await page.goto(base + entry.from, { waitUntil: 'domcontentloaded' })
        assert.ok(response?.ok())
      })
      const row = rows.at(-1)
      try {
        await page.goBack({ waitUntil: 'domcontentloaded' })
        await page.waitForURL(url => url.pathname === '/templates', { timeout: 5000 })
        await waitForNavigationContent(page, pending)
        row.backTo = new URL(page.url()).pathname
      } catch (error) {
        row.failure = `戻る操作: ${error.stack ?? error}`
        throw error
      } finally {
        const file = join(dir, `${row.id}.json`)
        writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...row }))
      }
    }
    if (process.env.CANONICAL_PROBE !== '1') {
      await page.goto(base + '/templates', { waitUntil: 'domcontentloaded' })
      await waitForNavigationContent(page, pending)
      const sidebar = page.locator('aside:has(nav[data-sidebar-scroll]):visible')
      await sidebar.getByRole('button', { name: '成果と分析', exact: true }).click()
      const link = sidebar.getByRole('link', { name: '成果とアフィリエイト', exact: true })
      assert.equal(await link.getAttribute('href'), '/affiliates?tab=affiliates')
      await observe({ from: '/templates', to: '/affiliates?tab=affiliates' }, () => link.click(), false)
      assert.equal(await link.getAttribute('aria-current'), 'page', '押した成果の項目が選択される')
    }
  } finally {
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
