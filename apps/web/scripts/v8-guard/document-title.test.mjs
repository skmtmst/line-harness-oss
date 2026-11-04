import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { mockFetch } from './mock-local.mjs'
import { stubApi } from './speed-budget.mjs'
import { trackPendingApiRequests, waitForNavigationContent } from './navigation-content-ready.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { styleDashboardMock } from '../../../../scripts/visual-qa/style-dashboard-mock.mjs'

const require = createRequire(import.meta.url)
const { build } = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite'))('esbuild')
const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const bundle = await build({ stdin: { resolveDir: webRoot, contents: `import {MENU_SECTIONS,HQ_MENU_SECTIONS} from './src/lib/menu'; export default [...MENU_SECTIONS,...HQ_MENU_SECTIONS].flatMap(section=>section.items.map(item=>item.href));` }, bundle: true, write: false, platform: 'node', format: 'esm' })
const menuRoutes = (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)).default
const routes = process.env.TITLE_ROUTES?.split(',') ?? [...new Set([...menuRoutes, '/form-submissions/edit?id=form-1', '/restaurant-test/menu/edit?id=menu-6', '/login', '/m', '/ops/dashboard', '/ops/tenants'])]
const base = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310'
const output = process.env.V8_GUARD_ARTIFACT_DIR || '/tmp/v8-guard/document-title'
const delays = process.env.TITLE_DELAYS?.split(',').map(Number) ?? [0, 600]
const results = []
mkdirSync(output, { recursive: true })
after(() => writeFileSync(join(output, 'summary.json'), JSON.stringify(results, null, 2)))

for (const width of [1152, 1440]) for (const delay of delays) test(`文書の題 ${width} API+${delay}`, async () => {
  styleDashboardMock('PUT', '/api/dashboard/style', new URLSearchParams(), { style: 'ec' })
  const browser = await connectGuardBrowser(), dir = join(output, `${width}-${delay}`)
  mkdirSync(dir, { recursive: true })
  const context = await browser.newContext({ viewport: { width, height: 1080 }, locale: 'ja-JP', ...(process.env.V8_GUARD_VIDEO === '1' ? { recordVideo: { dir: join(dir, 'video'), size: { width, height: 1080 } } } : {}) })
  const page = await context.newPage(), pending = trackPendingApiRequests(page), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value) }, PARITY_INIT)
  await page.addInitScript(() => {
    window.titleFrames = []
    const record = () => {
      if (document.readyState !== 'loading') window.titleFrames.push({ t: performance.now(), url: location.pathname + location.search, title: document.title, titles: document.querySelectorAll('head > title').length, h1: [...document.querySelectorAll('main h1')].map(node => node.textContent) })
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
  if (process.env.V8_GUARD_TITLE_FAULT === '1') await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { const title = document.createElement('title'); title.textContent = 'musubo LINE管理システム'; document.head.append(title) })
  })
  await stubApi(page, async (method, path) => {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    const response = await mockFetch(method, path), url = new URL(path, base)
    if (url.pathname === '/api/staff/me') {
      const body = JSON.parse(response.body)
      if (body.data) body.data.accountScope = 'all'
      response.body = JSON.stringify(body)
    }
    return response
  })
  async function observe(label, action, expectedPath) {
    await page.evaluate(() => { window.titleFrames = [] }).catch(() => {})
    const id = String(results.length + 1).padStart(3, '0'), errorsBefore = errors.length
    const previousTitle = await page.title(), previousUrl = page.url()
    let failure = null, settled = null
    try {
      await action()
      await waitForNavigationContent(page, pending)
      if (expectedPath) assert.equal(new URL(page.url()).pathname, expectedPath, '指定した画面へ着いた')
      settled = await page.title()
      assert.ok(settled?.endsWith(' | musubo'), `画面名が確定した: ${settled}`)
      if (['/templates', '/chats', '/form-submissions/edit', '/restaurant-test/menu/edit'].includes(new URL(page.url()).pathname)) {
        const heading = (await page.locator('main h1').first().innerText()).replace(/^メニュー管理\s*›\s*/, '').trim()
        assert.ok(heading && settled.includes(heading), `本文の題と一致: ${heading} / ${settled}`)
      }
      const afterReady = await page.evaluate(() => performance.now())
      await page.waitForTimeout(500)
      const frames = await page.evaluate(() => window.titleFrames)
      assert.ok(frames.length > 1)
      assert.ok(frames.every(frame => frame.title !== 'musubo LINE管理システム'), '書き出しの既定名が描画に混ざった')
      if (previousTitle !== settled && previousUrl !== page.url()) assert.ok(frames.filter(frame => frame.url === new URL(page.url()).pathname + new URL(page.url()).search).every(frame => frame.title !== previousTitle), '次の道で前の画面名が残った')
      assert.ok(frames.every(frame => frame.titles === 1), `title の数が1ではない: ${JSON.stringify(frames.find(frame => frame.titles !== 1))}`)
      assert.ok(frames.filter(frame => frame.t >= afterReady).every(frame => frame.title === settled), '読み終えたあとに題が戻った')
      assert.deepEqual(errors.slice(errorsBefore), [])
    } catch (error) { failure = error.stack ?? String(error); throw error }
    finally {
      const frames = await page.evaluate(() => window.titleFrames ?? []).catch(() => [])
      const row = { width, delay, id, label, url: page.url(), settled, frames: frames.length, failure, errors: errors.slice(errorsBefore) }
      results.push(row)
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...row, samples: frames }))
      await page.screenshot({ path: join(dir, `${id}.png`) }).catch(() => {})
    }
  }
  try {
    for (const route of routes) await observe(`初回 ${route}`, async () => {
      const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' })
      assert.ok(response?.ok(), `HTTP ${response?.status()}`)
    }, ({ '/conversions': '/affiliates', '/m': '/m/chats', '/booking/staff/shifts': '/booking/menus' })[new URL(route, base).pathname] ?? new URL(route, base).pathname)
    if (!process.env.TITLE_ROUTES) {
      await observe('再表示 テンプレート', () => page.goto(base + '/templates', { waitUntil: 'domcontentloaded' }), '/templates')
      for (const path of ['/settings/customer-look', '/ec-commerce']) await observe(`SPA ${path}`, async () => {
        const link = path === '/settings/customer-look'
          ? page.locator('aside:has(nav[data-sidebar-scroll]):visible').locator(`a[href="${path}"]`).first()
          : page.locator(`a[href="${path}"]:visible`).first()
        await link.waitFor({ state: 'visible' })
        await link.click()
        await page.waitForURL(url => url.pathname === path)
      }, path)
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
