import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * ルールを作る（★V6 `Rv8Jv`）の実挙動試験（#679）。
 *
 * Next.js で本物の画面を描き、ブラウザ操作で N-357〜N-359 を再現する。
 * ソース文字列ではなく、**画面から送られたリクエストと画面に出た文字**で判定する。
 *
 * 応答の作り方は2通り。
 *
 *   1. `openPage()` … 手元の応答表。速いので、下書きの数え方や店舗の取り違えを見る
 *   2. `openWorkerPage()` … **本物の Worker**（`apps/worker/src/routes/automations.ts`）を
 *      SQLite の D1 に載せて応答させる。別タブの競合と1人テストの版ずれは、
 *      「更新しても `draftVersionId` が変わらない」という Worker の作りが原因なので、
 *      手元の応答表で真似すると**その作りごと間違って写す**危険がある。
 */

const WEB_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const WORKER_SRC = fileURLToPath(new URL('../../../../../worker/src/', import.meta.url))
const requireFromWorker = createRequire(`${WORKER_SRC}index.ts`)
const API_ORIGIN = 'http://api.line-harness.test'
const ACCOUNT_A = 'account-a'
const ACCOUNT_B = 'account-b'
const FRIEND_A = 'friend-account-a'
const FRIEND_B = 'friend-account-b'
const DRAFT_STORAGE_KEY = 'lh-automation-new-draft-v1'

type StoredDraft = { id: string; draftVersionId: string }
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
  // 台が混んでいると後片付けだけで30秒を超えることがある。ここで転ぶと
  // 中身と関係ない赤になるので、待つ時間を長めに取り、失敗しても先へ進む。
  await browser?.close().catch(() => {})
  serverProcess?.kill('SIGTERM')
}, 120_000)

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': webOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Admin-Session',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: corsHeaders(),
    body: JSON.stringify(body),
  })
}

/** この画面の合否に関係しない、共通の下ごしらえ（在席・店の一覧・機能表）。 */
async function serveSharedStubs(route: Route, pathname: string): Promise<boolean> {
  if (pathname === '/api/auth/session') {
    await json(route, { success: true, data: { name: '試験担当', role: 'owner', permissionKeys: [] }, csrfToken: 'csrf-test' })
    return true
  }
  if (pathname === '/api/line-accounts') {
    await json(route, {
      success: true,
      data: [
        { id: ACCOUNT_A, channelId: 'channel-a', name: '店舗A', isActive: true, country: 'JP', role: 'shop', displayOrder: 1 },
        { id: ACCOUNT_B, channelId: 'channel-b', name: '店舗B', isActive: true, country: 'JP', role: 'shop', displayOrder: 2 },
      ],
    })
    return true
  }
  if (pathname === '/api/settings/features') {
    await json(route, {
      success: true,
      data: { features: {}, sidebarOrder: null, sidebarItemOrder: null, parentChildMode: false, specializedFeatureKeys: [], version: 1 },
    })
    return true
  }
  return false
}

async function answerPreflight(route: Route): Promise<void> {
  await route.fulfill({ status: 204, headers: corsHeaders() })
}

// ========== 手元の応答表 ==========

type MockDraft = {
  id: string
  draftVersionId: string
  name: string
  description: string | null
  eventType: string
  triggerConfig: Record<string, unknown>
  conditions: Record<string, unknown>
  actions: Array<{ id: string; type: string; params: Record<string, unknown>; onFailure: 'stop' }>
}

async function attachApiMock(page: Page, options: { slowCreate?: boolean; slowTest?: boolean } = {}): Promise<MockApi> {
  let createNumber = 0
  let releaseCreate = () => {}
  let releaseTest = () => {}
  const createBarrier = new Promise<void>((resolve) => { releaseCreate = resolve })
  const testBarrier = new Promise<void>((resolve) => { releaseTest = resolve })
  const state: MockApi = { calls: [], createCalls: [], updateCalls: [], testCalls: [], releaseCreate, releaseTest }
  // 本物の Worker と同じく、更新しても版の番号は変えずに中身だけ書き換える。
  const drafts = new Map<string, MockDraft>()

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') {
      await answerPreflight(route)
      return
    }

    let body: unknown = null
    try { body = request.postDataJSON() } catch { /* GETなど本文なし */ }
    const call = { method: request.method(), pathname: url.pathname, search: url.search, body }
    state.calls.push(call)

    if (await serveSharedStubs(route, url.pathname)) return

    if (url.pathname === '/api/automation-draft-resources') {
      await json(route, { success: true, data: { tags: [{ id: 'tag-vip', name: 'VIP' }], scenarios: [] } })
      return
    }
    if (url.pathname === '/api/automations' && request.method() === 'GET') {
      await json(route, { success: true, data: [], summary: { active: 0, stopped: 0, executionCount30d: 0, failureCount30d: 0 } })
      return
    }
    if (/^\/api\/automation-templates\/[^/]+\/drafts$/.test(url.pathname)) {
      state.createCalls.push(call)
      createNumber += 1
      if (options.slowCreate) await createBarrier
      const accountId = url.searchParams.get('account_id')
      const draft: MockDraft = {
        id: `draft-${accountId}-${createNumber}`,
        draftVersionId: `version-${accountId}-${createNumber}`,
        name: '問い合わせを見分ける',
        description: null,
        eventType: 'message_received',
        triggerConfig: {},
        conditions: {},
        actions: [{ id: 'step-1', type: 'add_tag', params: { tagId: '' }, onFailure: 'stop' }],
      }
      drafts.set(draft.id, draft)
      await json(route, { success: true, data: { id: draft.id, draftVersionId: draft.draftVersionId } })
      return
    }
    const draftMatch = /^\/api\/automation-drafts\/([^/]+)$/.exec(url.pathname)
    if (draftMatch && request.method() === 'PUT') {
      state.updateCalls.push(call)
      const draft = drafts.get(draftMatch[1])
      const patch = body as Partial<MockDraft>
      if (draft) {
        // 版の番号は据え置く。本物の Worker が同じ行を書き換えるのと同じ。
        Object.assign(draft, {
          name: patch.name ?? draft.name,
          eventType: patch.eventType ?? draft.eventType,
          triggerConfig: patch.triggerConfig ?? draft.triggerConfig,
          conditions: patch.conditions ?? draft.conditions,
          actions: patch.actions ?? draft.actions,
        })
      }
      await json(route, { success: true, data: { updated: true } })
      return
    }
    if (draftMatch && request.method() === 'GET') {
      const draft = drafts.get(draftMatch[1])
      if (!draft) {
        await json(route, { success: false, error: '編集中の下書きが見つかりません' }, 404)
        return
      }
      await json(route, { success: true, data: draft })
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

// ========== 本物の Worker ==========

/**
 * 本物の Worker を載せるのに要る形だけを書き出したもの。
 *
 * `apps/worker` の型は `apps/web` から読めない（別の依存の束）ので、
 * ここで使う口だけを最小限で写す。実体は `apps/worker` のものをそのまま動かす。
 */
interface WorkerContext {
  env: { DB: unknown }
  set: (key: string, value: unknown) => void
}

interface HonoLike {
  use: (path: string, handler: (c: WorkerContext, next: () => Promise<void>) => Promise<void>) => void
  route: (path: string, app: unknown) => void
  request: (input: string, init?: { method?: string; body?: string }) => Promise<Response>
}

interface SqliteStatement {
  run: (...args: unknown[]) => unknown
  get: (...args: unknown[]) => unknown
}

interface SqliteRaw {
  prepare: (sql: string) => SqliteStatement
}

interface WorkerHarness {
  /** `apps/worker` の automations ルートへそのまま投げる。 */
  request: (path: string, init?: { method?: string; body?: string }) => Promise<Response>
  /** SQLite を直接読む（画面を通さずに、いまDBに何があるかを確かめる）。 */
  raw: SqliteRaw
  calls: ApiCall[]
  testCalls: ApiCall[]
  releaseTest: () => void
}

/**
 * 本物の automations ルートを SQLite の D1 に載せる。
 *
 * `apps/worker` は変更していない。`packages/db/bootstrap.sql` を流した
 * その場限りのDBに、実物の Hono ルートをそのまま繋ぐだけ。
 */
async function startWorker(options: { slowTest?: boolean } = {}): Promise<WorkerHarness> {
  const { Hono } = await import(pathToFileURL(requireFromWorker.resolve('hono')).href) as { Hono: new () => HonoLike }
  const { automations } = await import(/* @vite-ignore */ `${WORKER_SRC}routes/automations.ts`) as { automations: unknown }
  const { createTestD1, insertFriend } = await import(/* @vite-ignore */ `${WORKER_SRC}test-utils/d1-sqlite.ts`) as {
    createTestD1: () => { db: unknown; raw: SqliteRaw }
    insertFriend: (raw: unknown, id: string, overrides?: Record<string, unknown>) => void
  }

  const testDb = createTestD1()
  const raw = testDb.raw
  raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')").run()
  // tags.name は全体で一意なので、店ごとに違う名前にする。
  for (const [id, channel, name, friendId, tagName] of [
    [ACCOUNT_A, 'channel-a', '店舗A', FRIEND_A, 'VIP（店舗A）'],
    [ACCOUNT_B, 'channel-b', '店舗B', FRIEND_B, 'VIP（店舗B）'],
  ]) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, '', '', 1, 'tenant-1')`,
    ).run(id, channel, name)
    raw.prepare('INSERT INTO tags (id, line_account_id, name) VALUES (?, ?, ?)').run(`tag-vip-${id}`, id, tagName)
    insertFriend(raw, friendId, { line_account_id: id })
  }

  const app = new Hono()
  app.use('*', async (c: WorkerContext, next: () => Promise<void>) => {
    c.env = { DB: testDb.db }
    c.set('staff', {
      id: 'admin-1', name: '管理者', role: 'admin', readOnly: false, tenantId: 'tenant-1', permissionKeys: [],
    })
    await next()
  })
  app.route('/', automations)

  let releaseTest = () => {}
  const testBarrier = new Promise<void>((resolve) => { releaseTest = resolve })
  const harness: WorkerHarness = {
    request: (path, init) => app.request(`http://worker.test${path}`, init),
    raw,
    calls: [],
    testCalls: [],
    releaseTest,
  }
  ;(harness as { slowTest?: boolean }).slowTest = options.slowTest
  ;(harness as { testBarrier?: Promise<void> }).testBarrier = testBarrier
  return harness
}

/** いま下書きに入っている本当の中身を、画面を通さずDBから読む。 */
function draftInDb(harness: WorkerHarness, id: string): { versionId: string; actions: unknown } {
  const row = harness.raw.prepare(
    `SELECT d.current_draft_version_id AS version_id, v.action_config AS actions
       FROM automation_definitions d
       JOIN automation_versions v ON v.id = d.current_draft_version_id
      WHERE d.id = ?`,
  ).get(id) as { version_id: string; actions: string }
  return { versionId: row.version_id, actions: JSON.parse(row.actions) }
}

async function attachWorkerApi(page: Page, harness: WorkerHarness): Promise<void> {
  const slowTest = (harness as { slowTest?: boolean }).slowTest
  const testBarrier = (harness as { testBarrier?: Promise<void> }).testBarrier
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') {
      await answerPreflight(route)
      return
    }
    let body: unknown = null
    try { body = request.postDataJSON() } catch { /* GETなど本文なし */ }
    const call = { method: request.method(), pathname: url.pathname, search: url.search, body }
    harness.calls.push(call)

    if (await serveSharedStubs(route, url.pathname)) return

    if (url.pathname.startsWith('/api/automation')) {
      if (/^\/api\/automations\/[^/]+\/test$/.test(url.pathname)) {
        harness.testCalls.push(call)
        if (slowTest) await testBarrier
      }
      const response = await harness.request(`${url.pathname}${url.search}`, {
        method: request.method(),
        body: request.method() === 'GET' ? undefined : (request.postData() ?? '{}'),
      })
      await route.fulfill({
        status: response.status,
        headers: { ...corsHeaders(), 'content-type': 'application/json' },
        body: await response.text(),
      })
      return
    }

    await json(route, { success: true, data: {} })
  })
}

// ========== 画面を開く ==========

async function preparePageIn(context: BrowserContext, options: { storedDrafts?: StoredDrafts; accountId?: string } = {}): Promise<Page> {
  const page = await context.newPage()
  page.on('console', (message) => { serverOutput += `\n[browser:${message.type()}] ${message.text()}` })
  page.on('pageerror', (error) => { serverOutput += `\n[browser:error] ${error.stack ?? error.message}` })
  await page.addInitScript(({ accountId, storedDrafts, draftKey }) => {
    localStorage.setItem('lh_selected_account', accountId)
    localStorage.setItem('lh_staff_role', 'owner')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
    if (storedDrafts) sessionStorage.setItem(draftKey, JSON.stringify(storedDrafts))
  }, { accountId: options.accountId ?? ACCOUNT_A, storedDrafts: options.storedDrafts, draftKey: DRAFT_STORAGE_KEY })
  return page
}

async function settle(page: Page, describe: () => string): Promise<void> {
  await page.goto(`${webOrigin}/automations/new`, { waitUntil: 'domcontentloaded' })
  await waitUntil(
    () => page.locator('#au-name').isVisible({ timeout: 200 }).catch(() => false),
    () => `入力欄が表示されませんでした（URL: ${page.url()}、${describe()}）`,
  )
  await waitUntil(
    () => page.getByRole('button', { name: '下書きに保存' }).isEnabled({ timeout: 200 }).catch(() => false),
    () => `保存ボタンが使える状態になりませんでした（URL: ${page.url()}、${describe()}）`,
  )
  await page.waitForTimeout(500)
  if (page.url() !== `${webOrigin}/automations/new` || !(await page.locator('#au-name').isVisible())) {
    throw new Error(`画面が安定しませんでした（URL: ${page.url()}、${describe()}、本文: ${(await page.locator('body').innerText()).slice(0, 1_000)}）`)
  }
}

async function openPage(options: {
  storedDrafts?: StoredDrafts
  slowCreate?: boolean
  slowTest?: boolean
} = {}): Promise<{ page: Page; api: MockApi }> {
  const context = await browser.newContext()
  contexts.add(context)
  const page = await preparePageIn(context, options)
  const api = await attachApiMock(page, options)
  await settle(page, () => `API: ${api.calls.map((call) => call.pathname).join(', ')}`)
  return { page, api }
}

async function openWorkerPage(options: { slowTest?: boolean } = {}): Promise<{ page: Page; context: BrowserContext; worker: WorkerHarness }> {
  const worker = await startWorker(options)
  const context = await browser.newContext()
  contexts.add(context)
  const page = await preparePageIn(context)
  await attachWorkerApi(page, worker)
  await settle(page, () => `API: ${worker.calls.map((call) => call.pathname).join(', ')}`)
  return { page, context, worker }
}

/** 同じ下書きを開いた「別タブ」。タブを複製すると sessionStorage も複製される。 */
async function openSecondTab(context: BrowserContext, worker: WorkerHarness, storedDrafts: StoredDrafts): Promise<Page> {
  const page = await preparePageIn(context, { storedDrafts })
  await attachWorkerApi(page, worker)
  await settle(page, () => `API: ${worker.calls.map((call) => call.pathname).join(', ')}`)
  return page
}

// ========== 画面操作 ==========

async function fillTagRule(page: Page, name: string) {
  await page.locator('#au-name').fill(name)
  const tag = page.getByLabel('自動化で付けるタグ')
  await waitUntil(() => tag.isEnabled(), 'タグ選択が使える状態になりませんでした')
  await tag.selectOption({ label: 'VIP' })
}

async function fillMessageRule(page: Page, name: string, message: string) {
  await page.locator('#au-name').fill(name)
  await page.locator('select[id^="au-action-"]').selectOption('send_message')
  await page.locator('textarea').fill(message)
}

async function saveDraft(page: Page) {
  await page.getByRole('button', { name: '下書きに保存' }).click()
  await page.getByText('下書きに保存しました。見込み人数を確認して、1人で試せます。').waitFor()
}

async function storedDraftsOf(page: Page): Promise<StoredDrafts> {
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? '{}') as StoredDrafts, DRAFT_STORAGE_KEY)
}

async function openTestConfirmation(page: Page, friendId: string) {
  await page.getByLabel('1人テストの友だちID').fill(friendId)
  await page.getByRole('button', { name: '1人で試す' }).click()
  const dialog = page.getByRole('dialog', { name: '1人テストの確認' })
  await dialog.waitFor()
  return dialog
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

    expect((await storedDraftsOf(page))[ACCOUNT_A]?.id).toBe('draft-account-a-1')

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
    const { page, api } = await openPage({
      storedDrafts: { [ACCOUNT_A]: { id: 'existing-a', draftVersionId: 'existing-version-a' } },
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
    await fillMessageRule(page, '予約返信', '予約を承りました。担当からご連絡します。')
    await saveDraft(page)

    // 保存後の未保存編集は、実際に送られる確認内容へ混ぜない。
    await page.locator('textarea').fill('まだ保存していない文面')
    const dialog = await openTestConfirmation(page, 'friend-001')
    expect(api.testCalls).toHaveLength(0)

    const text = await dialog.innerText()
    expect(text).toContain('送り先：friend-001')
    expect(text).toContain('メッセージ「予約を承りました。担当からご連絡します。」')
    expect(text).not.toContain('まだ保存していない文面')
    expect(text).toContain('メッセージが相手に届きます')
    expect(text).toContain('取り消せません')
    // 入力を変えたままなら、そのずれも隠さずに出す。
    expect(text).toContain('画面の入力は、ここに出ている内容と違います。')

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

describe('V6 ルールを作る（Rv8Jv）を本物のWorkerに繋いだときの1人テスト（#679）', () => {
  it('別タブが下書きを書き換えたら、確認したときの中身と違うので送らない', async () => {
    const { page, context, worker } = await openWorkerPage()
    await fillMessageRule(page, '予約返信', '最初の文面です。')
    await saveDraft(page)

    const stored = await storedDraftsOf(page)
    const draftId = stored[ACCOUNT_A]?.id as string
    expect(draftId).toBeTruthy()

    const dialog = await openTestConfirmation(page, FRIEND_A)
    expect(await dialog.innerText()).toContain('メッセージ「最初の文面です。」')
    expect(worker.testCalls).toHaveLength(0)

    // 別タブで同じ下書きを書き換える。
    const other = await openSecondTab(context, worker, stored)
    await fillMessageRule(other, '予約返信', '別タブが書き換えた文面です。')
    await saveDraft(other)

    // 本物の Worker は同じ行を書き換えるので、**版の番号は変わらない**。
    // だから「版の番号が同じなら安全」とは言えない。中身で見張るしかない。
    const afterOther = draftInDb(worker, draftId)
    expect(afterOther.versionId).toBe(stored[ACCOUNT_A]?.draftVersionId)
    expect(JSON.stringify(afterOther.actions)).toContain('別タブが書き換えた文面です。')

    await dialog.getByRole('button', { name: 'この内容で送る' }).click()
    await page.getByText('確認したあとに下書きが変わりました。送っていません。もう一度、送る内容を確認してください').waitFor()
    expect(worker.testCalls).toHaveLength(0)
    expect(await page.getByRole('dialog', { name: '1人テストの確認' }).count()).toBe(0)

    // 確認し直すと、いま送られる中身（別タブの文面）が出る。そこで初めて送れる。
    const retried = await openTestConfirmation(page, FRIEND_A)
    expect(await retried.innerText()).toContain('メッセージ「別タブが書き換えた文面です。」')
    await retried.getByRole('button', { name: 'この内容で送る' }).click()
    await page.getByText('1人テストを受け付けました（状態:', { exact: false }).waitFor()
    expect(worker.testCalls).toHaveLength(1)
    expect(worker.testCalls[0]?.body).toEqual({ versionId: afterOther.versionId, friendId: FRIEND_A })
  }, 90_000)

  it('1人テストの返事を待つ間に店舗を替えても、前の店の成否を次の店へ残さない', async () => {
    const { page, worker } = await openWorkerPage({ slowTest: true })
    await fillMessageRule(page, '予約返信', '店舗Aの文面です。')
    await saveDraft(page)

    // 成功する1人テストを送り、返事を待つ間に店舗Bへ移る。
    const dialog = await openTestConfirmation(page, FRIEND_A)
    await dialog.getByRole('button', { name: 'この内容で送る' }).click()
    await waitUntil(() => worker.testCalls.length === 1, '1人テストAPIが呼ばれませんでした')

    await page.getByLabel('LINEアカウント').selectOption(ACCOUNT_B)
    await waitUntil(
      async () => (await page.getByRole('dialog', { name: '1人テストの確認' }).count()) === 0,
      '店舗を替えても確認が残っています',
    )
    worker.releaseTest()
    await page.waitForTimeout(1_000)

    expect(await page.getByText('1人テストを受け付けました', { exact: false }).count()).toBe(0)
    expect(await page.getByRole('dialog', { name: '1人テストの確認' }).count()).toBe(0)
    // 店舗Bには、店舗Aの下書きも見込み人数も引き継がない。
    expect(await page.getByRole('button', { name: '1人で試す' }).isDisabled()).toBe(true)

    // 失敗する1人テスト（この店にいない友だち）でも、返事を店舗Bへ残さない。
    const failing = await openWorkerPage({ slowTest: true })
    await fillMessageRule(failing.page, '予約返信', '失敗する側の文面です。')
    await saveDraft(failing.page)
    const failingDialog = await openTestConfirmation(failing.page, FRIEND_B)
    await failingDialog.getByRole('button', { name: 'この内容で送る' }).click()
    await waitUntil(() => failing.worker.testCalls.length === 1, '失敗させる1人テストが呼ばれませんでした')

    await failing.page.getByLabel('LINEアカウント').selectOption(ACCOUNT_B)
    failing.worker.releaseTest()
    await failing.page.waitForTimeout(1_000)
    expect(await failing.page.getByText('テストする友だちが見つかりません', { exact: false }).count()).toBe(0)
    expect(await failing.page.getByText('1人テストを受け付けました', { exact: false }).count()).toBe(0)

    // 店舗Aへ戻しても、前の返事は残っていない。
    await failing.page.getByLabel('LINEアカウント').selectOption(ACCOUNT_A)
    await failing.page.waitForTimeout(500)
    expect(await failing.page.getByText('テストする友だちが見つかりません', { exact: false }).count()).toBe(0)
  }, 120_000)
})
