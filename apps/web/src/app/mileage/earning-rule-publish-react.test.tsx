// @vitest-environment happy-dom
/*
 * たまる決めごとの公開確認を本物の React で動かす試験(N-231 案1)。
 *
 * 文字列一致の契約試験では、確認窓が本当に出るか・確定のときだけ1回送られるか・
 * 取消で送られないか・409で勝手に送り直さないかを確かめられない。
 * ここは実物の mileage 画面を mount し、差し替えるのは通信だけにして、
 * 画面本体と `api.ts` は実物を通す。
 *
 * Required gate（`pnpm --filter web test`）は mileage の試験を拾うので、
 * この試験はそのまま必須ゲートに含まれる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountProvider } from '@/contexts/account-context'
import MileagePage from './page'

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=earning-rules'),
  usePathname: () => '/mileage',
}))

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

function ruleFixture() {
  return {
    id: 'rule-1',
    published: {
      name: 'あいさつでたまる',
      eventType: 'message_received',
      source: 'line',
      amount: 100,
      initialStatus: 'available',
      validFrom: null,
      validUntil: null,
      status: 'published',
      updatedAt: '2026-09-10T00:00:00.000Z',
    },
    draft: {
      name: 'あいさつでたまる',
      eventType: 'message_received',
      source: 'line',
      amount: 200,
      initialStatus: 'available',
      validFrom: null,
      validUntil: null,
      expiresAfterDays: null,
      cancellationEventTypes: [],
      targetConditions: null,
      sortOrder: 0,
      notification: { enabled: false, messageTemplate: '' },
    },
    draftVersion: 7,
    draftUpdatedAt: '2026-09-10T01:00:00.000Z',
    publishedVersion: 1,
    metrics30d: { eligible: 10, granted: 8, excluded: 2 },
  }
}

const friendsOverview = {
  items: [],
  summary: { totalMembers: 1, withBalanceCount: 1, available: 100, pending: 0 },
  pagination: { total: 1, limit: 1, offset: 0 },
}

/*
 * 通信の差し替え。呼ばれた口を全部残す。公開の返事だけ試験ごとに変える。
 */
function stubFetch(options: { publish: () => Response }) {
  const calls: Call[] = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) }
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    })
    if (url.includes('/api/mileage/earning-rules/rule-1/publish')) return options.publish()
    if (url.includes('/api/mileage/earning-rules')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          items: [ruleFixture()],
          pagination: { total: 1, limit: 20, offset: 0 },
          unassignedLegacyCount: 0,
          measuredAt: '2026-09-10T00:00:00.000Z',
        },
      }), { status: 200 })
    }
    if (url.includes('/api/mileage/history')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          items: [],
          pagination: { total: 0, limit: 1, offset: 0 },
          summary: { byType: [], totalAmount: 0, manualCount: 0 },
        },
      }), { status: 200 })
    }
    if (url.includes('/api/mileage/friends')) {
      return new Response(JSON.stringify({ success: true, data: friendsOverview }), { status: 200 })
    }
    if (url.includes('/api/mileage/rewards')) {
      return new Response(JSON.stringify({ success: true, data: { rewards: [] } }), { status: 200 })
    }
    if (url.includes('/api/staff/me')) {
      return new Response(JSON.stringify({ success: true, data: { id: 'owner-1', role: 'owner' } }), { status: 200 })
    }
    if (url.includes('/api/line-accounts')) {
      return new Response(JSON.stringify({
        success: true,
        data: [{ id: 'account-1', channelId: 'channel-1', name: '公式A', isActive: true, country: null, role: null, displayOrder: 0 }],
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
  }) as typeof globalThis.fetch
  return {
    calls,
    publishes: () => calls.filter((call) => call.url.includes('/api/mileage/earning-rules/rule-1/publish')),
  }
}

let container: HTMLDivElement
let root: Root
const originalFetch = globalThis.fetch

/*
 * この happy-dom には localStorage が無い。`api.ts` は更新の口で
 * CSRF札を localStorage から読むので、置かないと POST が届く前に落ちる。
 * 画面側の分岐ではなく実行環境の穴なので、最小の実物をここで置く。
 */
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

beforeEach(() => {
  installWebStorage()
  globalThis.localStorage.setItem('lh_selected_account', 'account-1')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  document.body.innerHTML = ''
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function renderPage() {
  await act(async () => {
    root.render(<AccountProvider><MileagePage /></AccountProvider>)
  })
}

async function waitForRowMenuButton(): Promise<HTMLButtonElement> {
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await Promise.resolve() })
    const button = container.querySelector('button[aria-label="あいさつでたまるのその他操作"]')
    if (button) return button as HTMLButtonElement
  }
  throw new Error('その他操作のボタンが出ませんでした')
}

async function waitForPublishItem(): Promise<HTMLButtonElement> {
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await Promise.resolve() })
    const items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    const item = items.find((node) => node.textContent?.trim() === '公開して反映')
    if (item) return item
  }
  throw new Error('公開して反映の項目が出ませんでした')
}

/* 「公開して反映」は行の「その他操作」メニューの中。開いてから項目を押す。 */
async function openPublishDialog() {
  await act(async () => { (await waitForRowMenuButton()).click() })
  await act(async () => { (await waitForPublishItem()).click() })
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="alertdialog"]')
}

function dialogConfirm(): HTMLButtonElement | null {
  const buttons = [...(dialog()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]
  return buttons.find((button) => button.textContent === '公開して反映') ?? null
}

function dialogCancel(): HTMLButtonElement | null {
  const buttons = [...(dialog()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]
  return buttons.find((button) => button.textContent === 'キャンセル') ?? null
}

async function settle(ticks = 6) {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

describe('たまる決めごとの公開確認(本物のReact)', () => {
  it('確定したときだけpublishを1回送り、版と確認ヘッダーを添える', async () => {
    const net = stubFetch({
      publish: () => new Response(JSON.stringify({
        success: true,
        data: { ruleId: 'rule-1', versionId: 'version-8', versionNumber: 8, publishedAt: '2026-09-10T02:00:00.000Z' },
      }), { status: 200 }),
    })
    await renderPage()

    // ボタンを押しただけでは送らない。確認窓が出る。
    await openPublishDialog()
    await settle()
    expect(net.publishes()).toHaveLength(0)
    expect(dialog()).not.toBeNull()

    // 確定で1回だけ送る。いまの下書き版と取消不可の確認・冪等キーを添える。
    await act(async () => { dialogConfirm()?.click() })
    await settle()
    expect(net.publishes()).toHaveLength(1)
    expect(net.publishes()[0].body).toBe(JSON.stringify({ accountId: 'account-1', expectedVersion: 7 }))
    expect(net.publishes()[0].headers['X-Confirm-Irreversible']).toBe('mileage-earning-rule-publish')
    expect(typeof net.publishes()[0].headers['Idempotency-Key']).toBe('string')
    expect(net.publishes()[0].headers['Idempotency-Key'].length).toBeGreaterThan(0)
    // 通ったら確認窓は閉じる。
    expect(dialog()).toBeNull()
  })

  it('取消したらAPIを1回も送らない', async () => {
    const net = stubFetch({
      publish: () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
    })
    await renderPage()

    await openPublishDialog()
    await settle()
    expect(dialog()).not.toBeNull()

    await act(async () => { dialogCancel()?.click() })
    await settle()
    expect(net.publishes()).toHaveLength(0)
    expect(dialog()).toBeNull()
  })

  it('409でも送り直さない', async () => {
    const net = stubFetch({
      publish: () => new Response(
        JSON.stringify({ success: false, error: '下書きを読み直してください' }),
        { status: 409 },
      ),
    })
    await renderPage()

    await openPublishDialog()
    await settle()
    await act(async () => { dialogConfirm()?.click() })
    await settle(10)
    expect(net.publishes()).toHaveLength(1)
    // 読み直しの案内を出して確認窓に残る。勝手に閉じない。
    expect(dialog()?.textContent ?? '').toContain('公開できませんでした')
    expect(dialog()).not.toBeNull()
  })
})
