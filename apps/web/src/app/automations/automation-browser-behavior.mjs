import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from '@playwright/test'

const outDir = join(process.cwd(), 'apps/web/out')

function contentType(path) {
  return ({
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
  })[extname(path)] ?? 'application/octet-stream'
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\//, '')
  const plain = join(outDir, relative || 'index.html')
  const candidates = extname(plain) ? [plain] : [`${plain}.html`, join(plain, 'index.html')]
  const file = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
  if (!file) {
    response.writeHead(404)
    response.end('not found')
    return
  }
  response.writeHead(200, { 'content-type': contentType(file) })
  createReadStream(file).pipe(response)
})

await new Promise((resolve) => server.listen(3157, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('テスト用サーバのポートを取得できません')
const baseUrl = `http://127.0.0.1:${address.port}`

const accounts = [
  { id: 'account-a', channelId: 'channel-a', name: 'A店', displayName: 'A店', isActive: true, country: 'JP', role: null, displayOrder: 0 },
  { id: 'account-b', channelId: 'channel-b', name: 'B店', displayName: 'B店', isActive: true, country: 'JP', role: null, displayOrder: 1 },
]

function automation(id, name, isActive = true) {
  return {
    id,
    name,
    description: `${name}の説明`,
    lineAccountId: 'account-a',
    eventType: 'friend_add',
    triggerConfig: {},
    conditions: {},
    actions: [{ type: 'add_tag', params: {} }],
    isActive,
    priority: 1,
    status: isActive ? 'active' : 'stopped',
    versionId: `${id}-version`,
    version: 1,
    executionCount30d: 3,
    failureCount30d: 0,
    lastRunAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

async function openHarness(browser, role) {
  const state = {
    items: [automation('automation-a', '購入後フォロー'), automation('automation-b', '誕生日通知')],
    updateCalls: 0,
    listCalls: [],
    runSearches: [],
    failNextUpdate: false,
    listDelayMs: {},
  }
  const context = await browser.newContext()
  await context.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'account-a')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error('browser page error:', error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('browser console:', message.text())
  })
  page.on('requestfailed', (request) => console.error('browser request failed:', request.url(), request.failure()?.errorText))
  await page.route('**/admin/version', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: '0.24.0', worker_hash: 'test', admin_hash: 'test', liff_hash: 'test' }),
  }))
  await page.route('**/admin/manifest', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ latest: '0.24.0', releases: [] }),
  }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (path === '/api/auth/session') {
      return json({ success: true, data: { name: `${role}利用者`, role, permissionKeys: [] }, csrfToken: 'test-csrf' })
    }
    if (path === '/api/line-accounts') return json({ success: true, data: accounts })
    if (path === '/api/automations' && request.method() === 'GET') {
      const selected = url.searchParams.get('lineAccountId')
      state.listCalls.push(selected)
      const delay = state.listDelayMs[selected ?? ''] ?? 0
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      const data = selected === 'account-b' ? [automation('automation-c', 'B店フォロー')] : state.items
      return json({
        success: true,
        data,
        summary: { active: data.filter((item) => item.isActive).length, stopped: data.filter((item) => !item.isActive).length, executionCount30d: 6, failureCount30d: 0 },
      })
    }
    if (/^\/api\/automations\/[^/]+$/.test(path) && request.method() === 'PUT') {
      state.updateCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (state.failNextUpdate) {
        state.failNextUpdate = false
        return json({ success: false, error: 'timeout' })
      }
      const id = decodeURIComponent(path.split('/').at(-1))
      const body = request.postDataJSON()
      state.items = state.items.map((item) => item.id === id ? { ...item, isActive: body.isActive, status: body.isActive ? 'active' : 'stopped' } : item)
      return json({ success: true, data: state.items.find((item) => item.id === id) })
    }
    if (path === '/api/automation-runs') {
      state.runSearches.push(url.searchParams.get('search'))
      return json({
        success: true,
        data: {
          summary: { total: 0, executed: 0, skipped: 0, failed: 0, mostRunName: null, mostRunCount: null },
          items: [],
          pagination: { total: 0, limit: 20, offset: 0 },
        },
      })
    }
    if (path === '/api/automation-templates' || path === '/api/common-actions') return json({ success: true, data: [] })
    if (path === '/api/admin/version') return json({ success: false, error: 'not configured' })
    if (path === '/api/settings/features') {
      return json({ success: true, data: { features: {}, sidebarOrder: null, sidebarItemOrder: null, parentChildMode: false, specializedFeatureKeys: [], version: 1 } })
    }
    return json({ success: true, data: [] })
  })

  return { context, page, state }
}

async function waitForAutomationPage(page) {
  try {
    await page.getByText('購入後フォロー', { exact: true }).waitFor({ timeout: 10_000 })
  } catch (error) {
    console.error('browser current URL:', page.url())
    console.error('browser body:', (await page.locator('body').innerText()).slice(0, 2_000))
    throw error
  }
}

const browser = await chromium.launch({ headless: true })
try {
  for (const role of ['owner', 'admin']) {
    const { context, page } = await openHarness(browser, role)
    await page.goto(`${baseUrl}/automations`)
    await waitForAutomationPage(page)
    assert.equal(await page.getByRole('link', { name: 'ルールを作成' }).count(), 1)
    assert.equal(await page.getByRole('button', { name: '止める・動かす' }).count(), 2)
    await context.close()
  }

  {
    const { context, page, state } = await openHarness(browser, 'owner')
    await page.goto(`${baseUrl}/automations`)
    await waitForAutomationPage(page)
    await page.getByRole('button', { name: '止める・動かす' }).first().click()
    const confirm = page.getByRole('button', { name: '止める', exact: true })
    await confirm.waitFor()
    await confirm.evaluate((button) => { button.click(); button.click() })
    await page.getByText('止めています', { exact: true }).first().waitFor()
    assert.equal(state.updateCalls, 1, '二重クリックで更新APIを2回呼ばない')

    state.failNextUpdate = true
    await page.getByRole('button', { name: '止める・動かす' }).nth(1).click()
    await page.getByRole('button', { name: '止める', exact: true }).click()
    await page.getByText('稼働を切り替えられませんでした。状態を読み直してから、もう一度お試しください。', { exact: true }).waitFor()
    assert.ok(state.listCalls.length >= 3, '失敗後も一覧APIを再取得する')

    await page.getByRole('button', { name: 'キャンセル' }).click()
    await page.getByRole('button', { name: '止める・動かす' }).first().click()
    await page.getByLabel('LINEアカウント').selectOption('account-b')
    await page.getByText(/押したあとにLINEアカウントが切り替わりました/).waitFor()
    assert.equal(await page.getByRole('button', { name: '動かす', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '止める', exact: true }).count(), 0)
    await context.close()
  }

  {
    const { context, page, state } = await openHarness(browser, 'staff')
    await page.goto(`${baseUrl}/automations`)
    await waitForAutomationPage(page)
    assert.equal(await page.getByRole('link', { name: 'ルールを作成' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '止める・動かす' }).count(), 0)
    assert.equal(await page.getByText('操作する権限がありません', { exact: true }).count(), 2)
    assert.equal(await page.getByRole('note').filter({ hasText: '閲覧のみのため、ルールの作成・変更はできません。' }).count(), 1)

    const links = page.getByRole('link', { name: '動いた記録を見る' })
    assert.equal(await links.count(), 2)
    await links.nth(1).click()
    const search = page.getByPlaceholder('友だちの名前・オートメーションの名前で検索')
    await search.waitFor()
    assert.equal(await search.inputValue(), '誕生日通知')
    await page.waitForTimeout(500)
    assert.equal(state.runSearches.at(-1), '誕生日通知')

    await search.fill('失敗した通知')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('search') === '失敗した通知')
    await page.reload()
    await search.waitFor()
    assert.equal(await search.inputValue(), '失敗した通知')
    await page.waitForTimeout(500)
    assert.equal(state.runSearches.at(-1), '失敗した通知')
    await context.close()
  }

  {
    /*
     * 逆順応答（account境界）。切り替える前に投げたA店の一覧が、B店の応答より
     * あとに届いても、B店の画面をA店の中身へ戻さないことを実ブラウザで確かめる。
     */
    const { context, page, state } = await openHarness(browser, 'owner')
    state.listDelayMs['account-a'] = 2_000
    const lateListA = page.waitForResponse((response) =>
      response.url().includes('/api/automations?') && response.url().includes('lineAccountId=account-a'))
    await page.goto(`${baseUrl}/automations`)
    const accountSelect = page.getByLabel('LINEアカウント')
    await accountSelect.waitFor()
    await accountSelect.selectOption('account-b')
    await page.getByText('B店フォロー', { exact: true }).waitFor()
    await lateListA
    await page.waitForTimeout(500)
    assert.equal(await page.getByText('購入後フォロー', { exact: true }).count(), 0, '切替前の遅い応答を新しいアカウントの一覧へ混ぜない')
    assert.equal(await page.getByText('B店フォロー', { exact: true }).count(), 1, '切替後の一覧が残っていない')
    await context.close()
  }

  console.log('automation browser behavior: PASS')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
