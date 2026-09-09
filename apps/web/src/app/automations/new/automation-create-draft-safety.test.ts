import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * ルールを作る（★V6 `Rv8Jv`）の実挙動試験（#679）。
 *
 * Next.js で本物の画面を描き、ブラウザ操作と API 応答で N-357〜N-359 を
 * 再現する。ソース文字列ではなく、画面から送られたリクエストを判定する。
 */

const WEB_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const API_ORIGIN = 'http://api.line-harness.test'
const ACCOUNT_A = 'account-a'
const ACCOUNT_B = 'account-b'
const DRAFT_STORAGE_KEY = 'lh-automation-new-draft-v1'

type SavedPreview = { contents: string[]; effects: string[] }
type StoredDraft = { id: string; draftVersionId: string; preview?: SavedPreview }
type StoredDrafts = Record<string, StoredDraft>

interface ApiCall {
  method: string
  pathname: string
  search: string
  body: unknown
}

interface MockApi {
  calls: ApiCall[]
  createCalls: ApiCall[]
  updateCalls: ApiCall[]
  testCalls: ApiCall[]
  releaseCreate: () => void
  releaseTest: () => void
}

let browser: Browser
let serverProcess: ChildProcess | null = null
let webOrigin = ''
let serverOutput = ''
const contexts = new Set<BrowserContext>()

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('試験用ポートを決められませんでした'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitUntil(check: () => boolean | Promise<boolean>, message: string | (() => string), timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${typeof message === 'function' ? message() : message}\n${serverOutput.slice(-4_000)}`)
}

beforeAll(async () => {
  const port = await freePort()
  webOrigin = `http://127.0.0.1:${port}`
  const nextBin = fileURLToPath(new URL('./node_modules/next/dist/bin/next', new URL(`file://${WEB_ROOT}/`)))
  serverProcess = spawn(process.execPath, [nextBin, 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: WEB_ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: API_ORIGIN,
      NEXT_PUBLIC_UPDATE_BANNER_ENABLED: 'false',
      WATCHPACK_POLLING: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcess.stdout?.on('data', (chunk) => { serverOutput += String(chunk) })
  serverProcess.stderr?.on('data', (chunk) => { serverOutput += String(chunk) })

  await waitUntil(async () => {
    try {
      return (await fetch(`${webOrigin}/automations/new`)).ok
    } catch {
      return false
    }
  }, 'Next.js の試験画面が起動しませんでした', 90_000)

  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch {
    browser = await chromium.launch({ headless: true })
  }
}, 120_000)

afterEach(async () => {
  await Promise.all([...contexts].map((context) => context.close()))
  contexts.clear()
})

afterAll(async () => {
  if (browser) await browser.close()
  serverProcess?.kill('SIGTERM')
}, 30_000)

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': webOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Admin-Session',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    },
    body: JSON.stringify(body),
  })
}

async function attachApiMock(page: Page, options: { slowCreate?: boolean; slowTest?: boolean } = {}): Promise<MockApi> {
  let createNumber = 0
  let releaseCreate = () => {}
  let releaseTest = () => {}
  const createBarrier = new Promise<void>((resolve) => { releaseCreate = resolve })
  const testBarrier = new Promise<void>((resolve) => { releaseTest = resolve })
  const state: MockApi = { calls: [], createCalls: [], updateCalls: [], testCalls: [], releaseCreate, releaseTest }

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': webOrigin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Admin-Session',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        },
      })
      return
    }

    let body: unknown = null
    try { body = request.postDataJSON() } catch { /* GETなど本文なし */ }
    const call = { method: request.method(), pathname: url.pathname, search: url.search, body }
    state.calls.push(call)

    if (url.pathname === '/api/auth/session') {
      await json(route, { success: true, data: { name: '試験担当', role: 'owner', permissionKeys: [] }, csrfToken: 'csrf-test' })
      return
    }
    if (url.pathname === '/api/line-accounts') {
      await json(route, {
        success: true,
        data: [
          { id: ACCOUNT_A, channelId: 'channel-a', name: '店舗A', isActive: true, country: 'JP', role: 'shop', displayOrder: 1 },
          { id: ACCOUNT_B, channelId: 'channel-b', name: '店舗B', isActive: true, country: 'JP', role: 'shop', displayOrder: 2 },
        ],
      })
      return
    }
    if (url.pathname === '/api/automation-draft-resources') {
      await json(route, { success: true, data: { tags: [{ id: 'tag-vip', name: 'VIP' }], scenarios: [] } })
      return
    }
    if (url.pathname === '/api/automations' && request.method() === 'GET') {
      await json(route, { success: true, data: [], summary: { active: 0, stopped: 0, executionCount30d: 0, failureCount30d: 0 } })
      return
    }
    if (url.pathname === '/api/settings/features') {
      await json(route, {
        success: true,
        data: { features: {}, sidebarOrder: null, sidebarItemOrder: null, parentChildMode: false, specializedFeatureKeys: [], version: 1 },
      })
      return
    }
    if (/^\/api\/automation-templates\/[^/]+\/drafts$/.test(url.pathname)) {
      state.createCalls.push(call)
      createNumber += 1
      if (options.slowCreate) await createBarrier
      const accountId = url.searchParams.get('account_id')
      await json(route, { success: true, data: { id: `draft-${accountId}-${createNumber}`, draftVersionId: `version-${accountId}-${createNumber}` } })
      return
    }
    if (/^\/api\/automation-drafts\/[^/]+$/.test(url.pathname) && request.method() === 'PUT') {
      state.updateCalls.push(call)
      await json(route, { success: true, data: { updated: true } })
      return
    }
    if (/^\/api\/automations\/[^/]+\/audience-preview$/.test(url.pathname)) {
      await json(route, { success: true, data: { automationId: 'draft', versionId: 'version', matched: 3, total: 10, freshness: 'available', calculatedAt: '2026-09-09T00:00:00.000Z' } })
      return
    }
    if (/^\/api\/automations\/[^/]+\/test$/.test(url.pathname)) {
      state.testCalls.push(call)
      if (options.slowTest) await testBarrier
      await json(route, { success: true, data: { runId: 'run-1', versionId: 'version', status: 'accepted' } })
      return
    }

    // サイドバーなど、この画面の合否に関係しない共通取得。
    await json(route, { success: true, data: {} })
  })
  return state
}

async function openPage(options: {
  storedDrafts?: StoredDrafts
  slowCreate?: boolean
  slowTest?: boolean
} = {}): Promise<{ page: Page; api: MockApi }> {
  const context = await browser.newContext()
  contexts.add(context)
  const page = await context.newPage()
  page.on('console', (message) => { serverOutput += `\n[browser:${message.type()}] ${message.text()}` })
  page.on('pageerror', (error) => { serverOutput += `\n[browser:error] ${error.stack ?? error.message}` })
  await page.addInitScript(({ accountId, storedDrafts, draftKey }) => {
    localStorage.setItem('lh_selected_account', accountId)
    localStorage.setItem('lh_staff_role', 'owner')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
    if (storedDrafts) sessionStorage.setItem(draftKey, JSON.stringify(storedDrafts))
  }, { accountId: ACCOUNT_A, storedDrafts: options.storedDrafts, draftKey: DRAFT_STORAGE_KEY })
  const api = await attachApiMock(page, options)
  await page.goto(`${webOrigin}/automations/new`, { waitUntil: 'domcontentloaded' })
  await waitUntil(
    () => page.locator('#au-name').isVisible({ timeout: 200 }).catch(() => false),
    () => `入力欄が表示されませんでした（URL: ${page.url()}、API: ${api.calls.map((call) => call.pathname).join(', ')}）`,
  )
  await waitUntil(
    () => page.getByRole('button', { name: '下書きに保存' }).isEnabled({ timeout: 200 }).catch(() => false),
    () => `保存ボタンが使える状態になりませんでした（URL: ${page.url()}、API: ${api.calls.map((call) => call.pathname).join(', ')}）`,
  )
  await page.waitForTimeout(500)
  if (page.url() !== `${webOrigin}/automations/new` || !(await page.locator('#au-name').isVisible())) {
    throw new Error(`画面が安定しませんでした（URL: ${page.url()}、API: ${api.calls.map((call) => call.pathname).join(', ')}、本文: ${(await page.locator('body').innerText()).slice(0, 1_000)}）`)
  }
  return { page, api }
}

async function fillTagRule(page: Page, name: string) {
  await page.locator('#au-name').fill(name)
  const tag = page.getByLabel('自動化で付けるタグ')
  await waitUntil(() => tag.isEnabled(), 'タグ選択が使える状態になりませんでした')
  await tag.selectOption('tag-vip')
}

async function saveDraft(page: Page) {
  await page.getByRole('button', { name: '下書きに保存' }).click()
  await page.getByText('下書きに保存しました。見込み人数を確認して、1人で試せます。').waitFor()
}

describe('V6 ルールを作る（Rv8Jv）の誤操作防止（#679）', () => {
  it('遅い新規保存を連打しても1件だけ作り、再読込・戻るでも同じ下書きを更新する', async () => {
    const { page, api } = await openPage({ slowCreate: true })
    await fillTagRule(page, '来店後フォロー')

    const save = page.getByRole('button', { name: '下書きに保存' })
    await save.evaluate((element) => {
      const button = element as HTMLButtonElement
      button.click()
      button.click()
    })
    await waitUntil(() => api.createCalls.length === 1, '新規下書きAPIが呼ばれませんでした')
    expect(await save.isDisabled()).toBe(true)
    api.releaseCreate()
    await page.getByText('下書きに保存しました。見込み人数を確認して、1人で試せます。').waitFor()
    expect(api.createCalls).toHaveLength(1)
    expect(api.updateCalls).toHaveLength(1)
    expect(api.updateCalls[0]?.pathname).toBe('/api/automation-drafts/draft-account-a-1')

    const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? '{}') as StoredDrafts, DRAFT_STORAGE_KEY)
    expect(stored[ACCOUNT_A]?.id).toBe('draft-account-a-1')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('#au-name').waitFor()
    await fillTagRule(page, '再読込後の更新')
    await saveDraft(page)
    expect(api.createCalls).toHaveLength(1)
    expect(api.updateCalls).toHaveLength(2)

    await page.getByRole('button', { name: 'キャンセル' }).click()
    await page.waitForURL(`${webOrigin}/automations`)
    await page.goBack({ waitUntil: 'domcontentloaded' })
    await page.locator('#au-name').waitFor()
    await fillTagRule(page, '戻った後の更新')
    await saveDraft(page)
    expect(api.createCalls).toHaveLength(1)
    expect(api.updateCalls).toHaveLength(3)
  }, 60_000)

  it('遅延保存中に店舗を往復しても、既存下書きと新規下書きを取り違えない', async () => {
    const existingPreview = { contents: ['タグ「VIP」を付ける'], effects: ['タグが相手に付きます'] }
    const { page, api } = await openPage({
      storedDrafts: { [ACCOUNT_A]: { id: 'existing-a', draftVersionId: 'existing-version-a', preview: existingPreview } },
      slowCreate: true,
    })

    await page.getByLabel('LINEアカウント').selectOption(ACCOUNT_B)
    await page.waitForTimeout(50)
    await fillTagRule(page, '遅延中の新規B')
    await page.getByRole('button', { name: '下書きに保存' }).click()
    await waitUntil(() => api.createCalls.length === 1, '店舗Bの新規下書きAPIが呼ばれませんでした')

    // Bの保存応答を待たずAへ戻す。遅いBの応答をAの状態へ混ぜてはいけない。
    await page.getByLabel('LINEアカウント').selectOption(ACCOUNT_A)
    api.releaseCreate()
    await waitUntil(() => api.updateCalls.some((call) => call.pathname === '/api/automation-drafts/draft-account-b-1'), '店舗Bの保存が終わりませんでした')
    await waitUntil(() => page.getByRole('button', { name: '下書きに保存' }).isEnabled({ timeout: 200 }).catch(() => false), '保存中の状態が終わりませんでした')

    await page.getByLabel('1人テストの友だちID').fill('friend-a')
    expect(await page.getByRole('button', { name: '1人で試す' }).isEnabled()).toBe(true)
    await fillTagRule(page, '既存Aを更新')
    await saveDraft(page)
    expect(api.createCalls).toHaveLength(1)
    expect(api.updateCalls.at(-1)?.pathname).toBe('/api/automation-drafts/existing-a')

    // Bへ戻っても、遅延保存で作ったBの下書きを再利用する。
    await page.getByLabel('LINEアカウント').selectOption(ACCOUNT_B)
    await page.waitForTimeout(50)
    await fillTagRule(page, 'Bへ戻って更新')
    await saveDraft(page)
    expect(api.createCalls).toHaveLength(1)
    expect(api.updateCalls.at(-1)?.pathname).toBe('/api/automation-drafts/draft-account-b-1')
  }, 60_000)

  it('1人テストは保存済みの実文面・送り先・副作用を確認してから1回だけ送る', async () => {
    const { page, api } = await openPage({ slowTest: true })
    await page.locator('#au-name').fill('予約返信')
    await page.locator('select[id^="au-action-"]').selectOption('send_message')
    const message = page.locator('textarea')
    await message.fill('予約を承りました。担当からご連絡します。')
    await saveDraft(page)

    // 保存後の未保存編集は、実際に送られる確認内容へ混ぜない。
    await message.fill('まだ保存していない文面')
    await page.getByLabel('1人テストの友だちID').fill('friend-001')
    await page.getByRole('button', { name: '1人で試す' }).click()
    expect(api.testCalls).toHaveLength(0)

    const dialog = page.getByRole('dialog', { name: '1人テストの確認' })
    const text = await dialog.innerText()
    expect(text).toContain('送り先：friend-001')
    expect(text).toContain('メッセージ「予約を承りました。担当からご連絡します。」')
    expect(text).not.toContain('まだ保存していない文面')
    expect(text).toContain('メッセージが相手に届きます')
    expect(text).toContain('取り消せません')

    const confirm = dialog.getByRole('button', { name: 'この内容で送る' })
    await confirm.evaluate((element) => {
      const button = element as HTMLButtonElement
      button.click()
      button.click()
    })
    await waitUntil(() => api.testCalls.length === 1, '1人テストAPIが呼ばれませんでした')
    expect(await dialog.locator('button').last().isDisabled()).toBe(true)
    expect(api.testCalls[0]?.body).toEqual({ versionId: 'version-account-a-1', friendId: 'friend-001' })
    api.releaseTest()
    await page.getByText('1人テストを受け付けました（状態: accepted）').waitFor()
    expect(api.testCalls).toHaveLength(1)
  }, 60_000)

  it('タグきっかけは、付いたとき・外れたときを画面操作で選べる説明になっている', async () => {
    const { page } = await openPage()
    await page.getByRole('button', { name: 'タグが付いた・外れたとき' }).click()
    await page.getByText('選んだタグが付いたとき・外れたときに動きます。下でどちらかを選びます。').waitFor()
    const action = page.getByLabel('付いたとき・外れたとき')
    expect(await action.locator('option').allTextContents()).toEqual(['付いたとき', '外れたとき'])
    await action.selectOption('remove')
    expect(await action.inputValue()).toBe('remove')
  }, 60_000)
})
