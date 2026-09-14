// @vitest-environment happy-dom
/*
 * たまる決めごとの並び順保存を本物の React + 本物の route + 本物の SQLite で動かす試験(N-243)。
 *
 * 文字列一致の契約試験では「100件ずつ全頁を読むか」「一括口へ全IDが届くか」
 * 「旧アカウントの遅い応答が新しい一覧を上書きしないか」を確かめられない。
 * ここは実物の mileage 画面を mount し、/api/mileage/* は実物の scoring
 * ルート + 実認証(Bearer APIキー)へ回し、裏側は bootstrap.sql を適用した
 * better-sqlite3 にする。差し替えるのは account 一覧と本人情報だけ。
 */
import React, { act } from 'react'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountProvider, useAccount } from '@/contexts/account-context'
import MileagePage from './page'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=earning-rules'),
  usePathname: () => '/mileage',
}))

const REQUIRE_FROM_WORKER = createRequire(join(process.cwd(), '../worker/package.json'))
const WORKER_SRC = join(process.cwd(), '../worker/src/')

const ACC_A = 'acc-a'
const ACC_B = 'acc-b'
const KEY_OWNER = 'key-owner-aaa'

let db: unknown
let sqlite: { prepare: (sql: string) => { get: (...p: unknown[]) => unknown; all: (...p: unknown[]) => unknown; run: (...p: unknown[]) => unknown }; exec: (sql: string) => void }
type ScoringApp = { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> }
let app: ScoringApp

interface RecordedCall {
  url: string
  method: string
  body: string | null
}

const calls: RecordedCall[] = []
/*
 * 旧アカウント(acc-a)の2ページ目を遅らせるための門。試験ごとにセットする。
 * null の間は全リクエストを即座に通す。解放時の値 'ok' は成功応答、
 * 'fail' は通信失敗(fetchのreject)を再現する。
 */
let slowPageGate: Promise<'ok' | 'fail'> | null = null

const lineAccounts = [
  { id: ACC_A, channelId: `channel-${ACC_A}`, name: '店A', isActive: true, country: null, role: null, displayOrder: 0 },
  { id: ACC_B, channelId: `channel-${ACC_B}`, name: '店B', isActive: true, country: null, role: null, displayOrder: 1 },
]

async function workerCall(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY_OWNER}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: db })
}

/** 実routeで「決めごと＋下書き」を1件作る。 */
async function makeRule(accountId: string, name: string, sortOrder: number): Promise<string> {
  const created = await workerCall('POST', '/api/mileage/rules', {
    name, eventType: 'message_received', amount: 10, lineAccountId: accountId,
  })
  expect(created.status).toBe(201)
  const { data } = (await created.json()) as { data: { id: string } }
  const drafted = await workerCall('PATCH', `/api/mileage/earning-rules/${data.id}/draft`, {
    accountId,
    expectedVersion: null,
    draft: { name, eventType: 'message_received', amount: 10, initialStatus: 'available', sortOrder },
  })
  expect(drafted.status).toBe(200)
  return data.id
}

function draftSortOrder(ruleId: string): number {
  const row = sqlite.prepare(
    `SELECT json_extract(draft_json, '$.sortOrder') AS sort_order
       FROM mileage_earning_rule_drafts WHERE rule_id = ?`,
  ).get(ruleId) as { sort_order: number }
  return row.sort_order
}

/*
 * 通信の差し替え。/api/mileage/* は実物のルートへ回す。
 * 口座一覧と本人情報だけは scoring の外にあるので最小の返事をここで作る。
 */
function installFetch(): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null })
    const parsed = new URL(url)
    if (parsed.pathname === '/api/staff/me') {
      return new Response(JSON.stringify({ success: true, data: { id: 'owner-1', role: 'owner' } }), { status: 200 })
    }
    if (parsed.pathname === '/api/line-accounts') {
      return new Response(JSON.stringify({ success: true, data: lineAccounts }), { status: 200 })
    }
    if (
      slowPageGate &&
      parsed.pathname === '/api/mileage/earning-rules' &&
      parsed.searchParams.get('accountId') === ACC_A &&
      Number(parsed.searchParams.get('offset') ?? '0') >= 100
    ) {
      const verdict = await slowPageGate
      if (verdict === 'fail') throw new Error('network error')
    }
    if (parsed.pathname.startsWith('/api/mileage/')) {
      const headers = new Headers(init?.headers)
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${KEY_OWNER}`)
      return app.request(parsed.pathname + parsed.search, {
        method,
        headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      }, { DB: db })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
  }) as typeof globalThis.fetch
}

let container: HTMLDivElement
let root: Root
let selectedAccount: { setSelectedAccountId: (id: string) => void } | null = null
const originalFetch = globalThis.fetch

function AccountCapture() {
  const account = useAccount()
  selectedAccount = account
  return null
}

function installWebStorage(): void {
  const make = () => {
    const data = new Map<string, string>()
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, String(value)) },
      removeItem: (key: string) => { data.delete(key) },
      clear: () => { data.clear() },
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size },
    }
  }
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const holder = globalThis as unknown as Record<string, unknown>
    if (!holder[name]) {
      Object.defineProperty(globalThis, name, { value: make(), configurable: true })
    }
  }
}

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(async () => {
  calls.length = 0
  slowPageGate = null
  selectedAccount = null
  installWebStorage()
  globalThis.localStorage.setItem('lh_selected_account', ACC_A)
  const { createTestD1 } = await import(/* @vite-ignore */ join(WORKER_SRC, 'test-utils/d1-sqlite.ts'))
  const testD1 = createTestD1()
  sqlite = testD1.raw as unknown as typeof sqlite
  db = testD1.db
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run()
  for (const id of [ACC_A, ACC_B]) {
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 'tenant-1')`,
    ).run(id, `channel-${id}`, id)
  }
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', ?, 'tenant-1', 'all')`,
  ).run(KEY_OWNER)
  const { authMiddleware } = await import(/* @vite-ignore */ join(WORKER_SRC, 'middleware/auth.ts'))
  const { scoring } = await import(/* @vite-ignore */ join(WORKER_SRC, 'routes/scoring.ts'))
  const { Hono } = REQUIRE_FROM_WORKER('hono') as {
    Hono: new () => {
      use: (path: string, mw: unknown) => void
      route: (path: string, sub: unknown) => void
      request: ScoringApp['request']
    }
  }
  const instance = new Hono()
  instance.use('*', authMiddleware)
  instance.route('/', scoring)
  app = instance
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  document.body.innerHTML = ''
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function renderPage() {
  await act(async () => {
    root.render(<AccountProvider><AccountCapture /><MileagePage /></AccountProvider>)
  })
}

async function settle(ticks = 6) {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function waitForText(text: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await Promise.resolve() })
    if ((container.textContent ?? '').includes(text)) return
  }
  throw new Error(`「${text}」が出ませんでした: ${container.textContent?.slice(0, 300)}`)
}

function saveOrderButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((b) => b.textContent === '並び順を保存')
  if (!button) throw new Error('並び順を保存ボタンが見つかりません')
  return button as HTMLButtonElement
}

function orderCalls(): RecordedCall[] {
  return calls.filter((call) => call.url.includes('/api/mileage/earning-rules-order'))
}

describe('たまる決めごとの並び順保存(本物のReact + 本物のroute + 実SQLite)', () => {
  it('101件ある決めごとは全頁を読み、全IDを一括口へ1回で送って200になる', async () => {
    const ids: string[] = []
    for (let i = 0; i < 101; i += 1) ids.push(await makeRule(ACC_A, `決めごと${i}`, i))
    installFetch()
    await renderPage()

    // 1頁目100件 + 2頁目1件。全件読めていること。
    const listCalls = calls.filter((call) => call.url.includes('/api/mileage/earning-rules?'))
    await waitForText('決めごと 101件のうち')
    expect(listCalls.length).toBeGreaterThanOrEqual(2)

    // 先頭の決めごとを1つ下へ動かして保存する。
    const firstDown = [...container.querySelectorAll('tbody tr button')]
      .find((b) => b.textContent === '下へ' && !(b as HTMLButtonElement).disabled)
    expect(firstDown).toBeTruthy()
    await act(async () => { (firstDown as HTMLButtonElement).click() })
    await settle()
    expect(saveOrderButton().disabled).toBe(false)

    await act(async () => { saveOrderButton().click() })
    await vi.waitFor(() => { expect(orderCalls()).toHaveLength(1) })
    await settle(10)

    // 1頁目(100件)だけでなく101件全部のIDが1回で届く。409にならない。
    expect(orderCalls()).toHaveLength(1)
    const sent = JSON.parse(orderCalls()[0].body ?? '{}') as { accountId: string; ids: string[] }
    expect(sent.accountId).toBe(ACC_A)
    expect(sent.ids).toHaveLength(101)
    expect(sent.ids[0]).toBe(ids[1])
    expect(sent.ids[1]).toBe(ids[0])
    expect(sent.ids.slice(2)).toEqual(ids.slice(2))

    // 実SQLiteでも101件全部の順序が変わっている(部分適用なし)。
    expect(draftSortOrder(ids[1])).toBe(0)
    expect(draftSortOrder(ids[0])).toBe(1)
    expect(draftSortOrder(ids[100])).toBe(100)
  })

  it('旧アカウントの遅い2ページ目は新しいアカウントの一覧と送信IDを上書きしない', async () => {
    // acc-a は101件(2頁)、acc-b は3件(1頁)。
    const aIds: string[] = []
    for (let i = 0; i < 101; i += 1) aIds.push(await makeRule(ACC_A, `店Aの決めごと${i}`, i))
    const bIds: string[] = []
    for (let i = 0; i < 3; i += 1) bIds.push(await makeRule(ACC_B, `店Bの決めごと${i}`, i))

    // acc-a の2頁目だけ試験側で押さえる。
    let releaseSlowPage!: (verdict: 'ok' | 'fail') => void
    slowPageGate = new Promise<'ok' | 'fail'>((resolve) => { releaseSlowPage = resolve })
    installFetch()
    await renderPage()

    // acc-a の1頁目と一覧サマリは届くが、2頁目は門で止まっている。
    await vi.waitFor(async () => {
      const held = calls.filter((call) => {
        const u = new URL(call.url)
        return u.pathname === '/api/mileage/earning-rules'
          && u.searchParams.get('accountId') === ACC_A
          && Number(u.searchParams.get('offset') ?? '0') >= 100
      })
      expect(held.length).toBeGreaterThanOrEqual(1)
    })

    // 2頁目が来る前に acc-b へ切り替える。acc-b の全読み込みを終わらせる。
    await act(async () => { selectedAccount?.setSelectedAccountId(ACC_B) })
    await waitForText('店Bの決めごと0')

    // ここで acc-a の遅かった2頁目を解放する。世代がずれているので捨てられる。
    releaseSlowPage('ok')
    slowPageGate = null
    await settle(10)

    // 一覧は acc-b のまま(101件の acc-a に化けない)。
    expect(container.textContent ?? '').toContain('決めごと 3件のうち')
    expect(container.textContent ?? '').not.toContain('決めごと 101件のうち')

    // 送信するIDも acc-b の3件だけ。旧アカウントのIDは混ざらない。
    const firstDown = [...container.querySelectorAll('tbody tr button')]
      .find((b) => b.textContent === '下へ' && !(b as HTMLButtonElement).disabled)
    await act(async () => { (firstDown as HTMLButtonElement).click() })
    await settle()
    await act(async () => { saveOrderButton().click() })
    await vi.waitFor(() => { expect(orderCalls()).toHaveLength(1) })
    await settle(10)

    expect(orderCalls()).toHaveLength(1)
    const sent = JSON.parse(orderCalls()[0].body ?? '{}') as { accountId: string; ids: string[] }
    expect(sent.accountId).toBe(ACC_B)
    expect(sent.ids).toHaveLength(3)
    expect(sent.ids).toEqual([bIds[1], bIds[0], bIds[2]])
  })

  it('旧アカウントの遅い2ページ目が失敗しても、新しいアカウントへエラーを残さない', async () => {
    // acc-a は101件(2頁)、acc-b は3件(1頁)。
    for (let i = 0; i < 101; i += 1) await makeRule(ACC_A, `店Aの決めごと${i}`, i)
    for (let i = 0; i < 3; i += 1) await makeRule(ACC_B, `店Bの決めごと${i}`, i)

    let releaseSlowPage!: (verdict: 'ok' | 'fail') => void
    slowPageGate = new Promise<'ok' | 'fail'>((resolve) => { releaseSlowPage = resolve })
    installFetch()
    await renderPage()

    // acc-a の2頁目が呼ばれて門で止まるのを待つ。
    await vi.waitFor(async () => {
      const held = calls.filter((call) => {
        const u = new URL(call.url)
        return u.pathname === '/api/mileage/earning-rules'
          && u.searchParams.get('accountId') === ACC_A
          && Number(u.searchParams.get('offset') ?? '0') >= 100
      })
      expect(held.length).toBeGreaterThanOrEqual(1)
    })

    // acc-b へ切り替え、その読み込みを終わらせる。
    await act(async () => { selectedAccount?.setSelectedAccountId(ACC_B) })
    await waitForText('店Bの決めごと0')

    // ここで acc-a の遅かった2頁目を「失敗」で解放する。
    // 世代がずれているので reject は飲まれ、新しい画面に何も残らない。
    releaseSlowPage('fail')
    slowPageGate = null
    await settle(10)

    // acc-b の一覧はそのまま。旧アカウント由来のエラーも出ない。
    expect(container.textContent ?? '').toContain('決めごと 3件のうち')
    expect(container.textContent ?? '').toContain('店Bの決めごと0')
    expect(container.textContent ?? '').not.toContain('マイルデータを読み込めませんでした')
    expect(container.textContent ?? '').not.toContain('並び順を保存できませんでした')
    expect(container.textContent ?? '').not.toContain('決めごと 101件のうち')
  })
})
