// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 司令塔独立審査(Opus, 2026-09-09)の差し戻し: `ec-commerce-load-contract.test.ts`は
 * `readFileSync(page.tsx)` への文字列一致だけで、実行4ms・mountもレンダリングもない。
 * 逆変異(M3〜M7)を当てても表明された文字列はすべて残ったまま挙動だけが壊れるため、
 * gate内では検知できなかった。ここは本物のReact(react-dom/client)で
 * `EcCommercePage`(default export)をmountし、通信(fetchApi・api.ecCommerce)と
 * タブ・アカウント選択だけを差し替えて、実際の画面の文字と通信回数で挙動を見張る。
 * Next.jsのpage規約上 `page.tsx` は default export 以外を許さないため、
 * `EventsPanel` を個別にexportできない ―― default export をそのままmountする。
 *
 * - M3: boundTo() の先頭に `if (slot) return slot` を挿す → アカウント境界fenceが無効
 * - M4: loadRecords の guard直前に `currentAccountIdRef.current = accountId` を挿す
 *       → 古いクロージャ弾きが無効。再試行応答待ち中の切替でBの一覧が固まる
 * - M5: loadRecords の catch で overview まで pendingFor に戻す → 部分失敗保護が消える
 * - M6: `params.set('query', searchQuery)` を消す → 検索語がサーバへ行かない
 * - M7: `view: 'actions'` を消す → 新APIを使わなくなる(この PR の修正が丸ごと消える)
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))

vi.mock('next/link', () => ({ default: (props: { children?: React.ReactNode }) => props.children ?? null }))
vi.mock('@/components/layout/merged-tabs', () => ({ default: () => null, useMergedTab: () => 'events' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('./ec-tabs-view', () => ({ default: () => null }))
vi.mock('./connector-panel', () => ({ default: () => null }))
vi.mock('./subscriptions-panel', () => ({ default: () => null }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    fetchApi: vi.fn(),
    api: {
      ...actual.api,
      ecCommerce: {
        ...actual.api.ecCommerce,
        overview: vi.fn(),
        retryActionExecution: vi.fn(),
      },
    },
  }
})

import { api, fetchApi } from '@/lib/api'
import EcCommercePage from './page'

const mockFetchApi = fetchApi as unknown as ReturnType<typeof vi.fn>
const mockOverview = api.ecCommerce.overview as unknown as ReturnType<typeof vi.fn>
const mockRetry = api.ecCommerce.retryActionExecution as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  promise.catch(() => {})
  return { promise, resolve, reject }
}

function ok<T>(data: T) {
  return { success: true, data }
}

function overview(count: number) {
  return {
    total: count,
    processed: count,
    identityPending: 0,
    failed: 0,
    skipped: 0,
    last24h: count,
    lastReceivedAt: '2026-09-09T00:00:00.000Z',
    averageDeliverySeconds: 30,
    latencySampleCount: count,
    byType: [{ eventType: 'ec.order.confirmed', label: '注文完了', count }],
  }
}

function action(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `action-${id}`,
    eventId: `event-${id}`,
    eventType: 'ec.order.confirmed',
    eventLabel: '注文完了',
    actionType: 'line_notification',
    ruleVersion: 'v1',
    status: 'succeeded',
    attemptCount: 1,
    maxAttempts: 3,
    errorCode: null,
    errorMessage: null,
    lastAttemptedAt: null,
    nextRetryAt: null,
    version: 1,
    receivedAt: '2026-09-09T00:00:00.000Z',
    orderNumber: `NEN-${id}`,
    customerName: '田中 花子',
    friendId: 'friend-a',
    retryAvailable: false,
    order: {
      id: `order-${id}`,
      lineAccountId: 'account-a',
      externalOrderId: `NEN-${id}`,
      orderNumber: `NEN-${id}`,
      customerId: `customer-${id}`,
      friendId: 'friend-a',
      customerName: '田中 花子',
      status: 'current',
      providerStatus: 'paid',
      currency: 'JPY',
      totalAmount: 100,
      refundedAmount: null,
      orderedAt: '2026-09-09T00:00:00.000Z',
      detailUrl: null,
      version: 1,
      orderLines: [{
        id: `line-${id}`,
        productId: `product-${id}`,
        productName: `商品${id}`,
        quantity: 1,
        unitAmount: 100,
        lineAmount: 100,
        productUrl: null,
      }],
    },
    ...overrides,
  }
}

function recordsList(items: ReturnType<typeof action>[], total = items.length) {
  return {
    items,
    total,
    summary: { pending: 0, processing: 0, succeeded: items.length, skipped: 0, retryable_failed: 0, permanent_failed: 0 },
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let eventsCalls: string[] = []
let eventsDeferreds: Deferred<unknown>[] = []
let overviewCalls: string[] = []
let overviewDeferreds: Map<string, Deferred<unknown>[]> = new Map()

beforeEach(() => {
  vi.useFakeTimers()
  fixture.accountId = 'account-a'
  eventsCalls = []
  eventsDeferreds = []
  overviewCalls = []
  overviewDeferreds = new Map()

  mockFetchApi.mockImplementation((path: string) => {
    eventsCalls.push(path)
    const d = deferred<unknown>()
    eventsDeferreds.push(d)
    return d.promise
  })
  mockOverview.mockImplementation((accountId: string) => {
    overviewCalls.push(accountId)
    const d = deferred<unknown>()
    const bucket = overviewDeferreds.get(accountId) ?? []
    bucket.push(d)
    overviewDeferreds.set(accountId, bucket)
    return d.promise
  })
  mockRetry.mockReset()
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  if (container) container.remove()
  root = null
  container = null
  vi.useRealTimers()
  vi.clearAllMocks()
})

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  return { container, root }
}

/** マイクロタスクだけを流す。setTimeout(debounce)はfakeのまま進めない。 */
async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function overviewFor(accountId: string, index = 0): Deferred<unknown> {
  const bucket = overviewDeferreds.get(accountId)
  const item = bucket?.[index]
  if (!item) throw new Error(`${accountId} 向けの overview 呼び出しが見つかりません`)
  return item
}

async function render(el: HTMLDivElement, r: Root) {
  await act(async () => { r.render(<EcCommercePage />) })
  void el
}

/**
 * `root.render()` をactで包まずに生で呼ぶと、Reactはcommit(DOM反映)と
 * passive effect(useEffectで走るload())のflushを別タスクとして積む。
 * MutationObserverはDOM変異の直後にマイクロタスクとして呼ばれるので、
 * commit直後・useEffect未実行の瞬間をこの1点で捕まえられる。
 */
function waitForCommit(el: HTMLDivElement): Promise<void> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      observer.disconnect()
      resolve()
    })
    observer.observe(el, { attributes: true, subtree: true, childList: true, characterData: true })
  })
}

function retryButton(el: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === 'もう一度やる')
  if (!button) throw new Error('「もう一度やる」ボタンが見つかりません')
  return button as HTMLButtonElement
}

function searchInput(el: HTMLDivElement): HTMLInputElement {
  const input = el.querySelector('input[type="search"]')
  if (!input) throw new Error('検索欄が見つかりません')
  return input as HTMLInputElement
}

describe('EC取込一覧(#685) 逆変異で赤になる実mount試験', () => {
  it('M3: アカウント切替の直後(commit直後・useEffect未実行)は前アカウントの一覧を表示し続けない', async () => {
    const { container: el, root: r } = mount()
    await render(el, r)
    await act(async () => { await drainMicrotasks() })

    await act(async () => {
      overviewFor('account-a').resolve(ok(overview(111)))
      eventsDeferreds[0].resolve(ok(recordsList([action('1')])))
      await drainMicrotasks()
    })
    expect(el.textContent).toContain('商品1')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const committed = waitForCommit(el)
    fixture.accountId = 'account-b'
    r.render(<EcCommercePage />)
    await committed
    errorSpy.mockRestore()

    // Bのcommitは終わっているが、useEffect(load)はまだ動いていない。
    // 境界fenceが効いていれば、この時点でAの商品はもう見えない。
    expect(el.textContent).not.toContain('商品1')
  })

  it('M4: Aの再試行応答待ち中にBへ切り替えても、Bの一覧読込は古いクロージャに邪魔されない', async () => {
    const { container: el, root: r } = mount()
    await render(el, r)
    await act(async () => { await drainMicrotasks() })

    await act(async () => {
      overviewFor('account-a').resolve(ok(overview(111)))
      eventsDeferreds[0].resolve(ok(recordsList([action('1', { status: 'retryable_failed', retryAvailable: true })])))
      await drainMicrotasks()
    })

    const retryDeferred = deferred<unknown>()
    mockRetry.mockReturnValueOnce(retryDeferred.promise)
    await act(async () => { retryButton(el).click() })
    expect(mockRetry).toHaveBeenCalledTimes(1)
    expect(eventsCalls).toHaveLength(1)

    // Bへ切替。B自身のuseEffect(load)がここでeventsCalls[1]を発行する。
    fixture.accountId = 'account-b'
    await act(async () => {
      r.render(<EcCommercePage />)
      await drainMicrotasks()
    })
    expect(eventsCalls).toHaveLength(2)

    // Aの遅い再試行応答が、ちょうどこの窓で届く。
    await act(async () => {
      retryDeferred.resolve(ok({ ...action('1'), status: 'pending' }))
      await drainMicrotasks()
    })

    // Bの一覧応答(2番目の呼び出し)を解決する。
    await act(async () => {
      overviewFor('account-b').resolve(ok(overview(7)))
      eventsDeferreds[1].resolve(ok(recordsList([action('77')])))
      await drainMicrotasks()
    })

    // 古いクロージャ弾きが効いていれば、Bの一覧はここで正しく表示される。
    // M4が入ると、Aの再試行応答が共有listLoadSeqを進めてしまい、
    // Bの正常応答はseq不一致で捨てられ、一覧は読み込み中のまま固まる。
    expect(el.textContent).toContain('商品77')
    expect(el.querySelector('[data-list-state]')?.getAttribute('data-list-state')).not.toBe('loading')
  })

  it('M5: 一覧の読込失敗は、確認済みの集計(overview)まで消さない', async () => {
    const { container: el, root: r } = mount()
    await render(el, r)
    await act(async () => { await drainMicrotasks() })

    await act(async () => {
      overviewFor('account-a').resolve(ok(overview(111)))
      eventsDeferreds[0].reject(new Error('boom'))
      await drainMicrotasks()
    })

    // 一覧は読み込めなかった帯が出るが、集計の111件は残っているべき。
    expect(el.textContent).toContain('取り込みの記録を読み込めませんでした')
    expect(el.textContent).toContain('111')
  })

  it('M6: 検索語をページ内フィルタではなくサーバへのURLへ反映する(query)', async () => {
    const { container: el, root: r } = mount()
    await render(el, r)
    await act(async () => { await drainMicrotasks() })
    await act(async () => {
      overviewFor('account-a').resolve(ok(overview(1)))
      eventsDeferreds[0].resolve(ok(recordsList([action('1')])))
      await drainMicrotasks()
    })

    const input = searchInput(el)
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeSetter.call(input, '商品21')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    await act(async () => { await drainMicrotasks() })

    const last = eventsCalls[eventsCalls.length - 1]
    expect(last).toContain('query=')
  })

  it('M7: 一覧取得は新API(view=actions)を使う', async () => {
    const { container: el, root: r } = mount()
    await render(el, r)
    await act(async () => { await drainMicrotasks() })

    expect(eventsCalls[0]).toContain('view=actions')
  })
})
