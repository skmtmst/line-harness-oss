// @vitest-environment happy-dom
/*
 * 「届かなかった交換」欄を本物の React で動かす試験(#641)。
 *
 * 文字列一致の契約試験では、欄が本当に理由を出しているか・押したら
 * 本当に1回だけ送られるか・店を替えたときに前の店の交換が残らないかを
 * 確かめられない（司令塔の独立再審査で繰り返し指摘された点）。
 * ここは実物の `MileageRewardsTab` を mount し、差し替えるのは通信だけに
 * して、画面本体と `api.ts` は実物を通す。
 *
 * Required gate（`pnpm --filter web test`）は `src/**\/*.test.tsx` を拾うので、
 * この試験はそのまま必須ゲートに含まれる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MileageRewardsTab from './mileage-rewards-tab'

vi.mock('next/link', () => ({ default: () => null }))

const overview = {
  rewards: [],
  summary: {
    publishedCount: 0,
    redeemedMilesThisMonth: 0,
    neverRedeemedFriendCount: 0,
    mostRedeemedRewardName: null,
    mostRedeemedRewardCount: null,
  },
  reachMetrics: [],
  rankBenefits: [],
  measuredAt: '2026-09-09T00:00:00.000Z',
}

function failedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'redemption-1',
    rewardName: '500円引き',
    status: 'delivery_failed',
    attemptCount: 3,
    failureCode: 'reward_delivery_failed',
    failureMessage: '特典を渡せませんでした',
    updatedAt: '2026-09-09T01:02:03.000Z',
    ...overrides,
  }
}

interface Call { url: string; method: string; body: string | null }

/**
 * 通信の差し替え。呼ばれた口を全部残す。
 * 一覧の応答は店ごとに引ける（店を替えたときの見え方を当てるため）。
 */
function stubFetch(options: {
  itemsByAccount: Record<string, Array<Record<string, unknown>>>
  onRetry?: (calls: number) => Promise<Response>
  onList?: (calls: number) => Promise<Response> | null
}) {
  const calls: Call[] = []
  let retryCalls = 0
  let listCalls = 0
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: typeof init?.body === 'string' ? init.body : null,
    })
    if (url.includes('/retry-fulfillment')) {
      retryCalls += 1
      if (options.onRetry) return options.onRetry(retryCalls)
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    }
    if (url.includes('/api/mileage/redemptions')) {
      listCalls += 1
      const override = options.onList?.(listCalls)
      if (override) return override
      const params = new URL(url, 'https://example.test').searchParams
      const accountId = params.get('accountId') ?? ''
      const limit = Number(params.get('limit') ?? 20) || 20
      const offset = Number(params.get('offset') ?? 0) || 0
      const all = options.itemsByAccount[accountId] ?? []
      const items = all.slice(offset, offset + limit)
      return new Response(
        JSON.stringify({ success: true, data: { items, pagination: { total: all.length, limit, offset } } }),
        { status: 200 },
      )
    }
    if (url.includes('/api/mileage/rewards')) {
      return new Response(JSON.stringify({ success: true, data: overview }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
  }) as typeof globalThis.fetch
  return {
    calls,
    retries: () => calls.filter((call) => call.url.includes('/retry-fulfillment')),
    lists: () => calls.filter((call) =>
      call.method === 'GET' && call.url.includes('/api/mileage/redemptions')),
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
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function render(accountId: string | null) {
  await act(async () => {
    root.render(<MileageRewardsTab accountId={accountId} />)
  })
  // 使い道と交換の2本の取得が落ち着くまで回す。
  await act(async () => { await Promise.resolve() })
}

function section(): HTMLElement | null {
  return container.querySelector('section[aria-label="要対応の交換"]')
}

function retryButtons(): HTMLButtonElement[] {
  return [...(section()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]
}

describe('届かなかった交換の欄(本物のReact)', () => {
  it('どの交換がなぜ何回失敗したかと最終日時を出す', async () => {
    stubFetch({ itemsByAccount: { 'account-1': [failedRow()] } })
    await render('account-1')

    const text = section()?.textContent ?? ''
    expect(text).toContain('500円引き')
    expect(text).toContain('特典を渡せませんでした')
    expect(text).toContain('3回')
    // 最終日時は日本時間で出す。UTCの01:02は10:02。
    expect(text).toContain('2026/09/09 10:02')
    expect(text).toContain('もう一度届ける')
  })

  it('理由が空でも符号を出し、両方無いときだけ断りを出す', async () => {
    stubFetch({
      itemsByAccount: {
        'account-1': [
          failedRow({ id: 'r-code', failureMessage: null }),
          failedRow({ id: 'r-none', failureMessage: null, failureCode: null }),
        ],
      },
    })
    await render('account-1')

    const text = section()?.textContent ?? ''
    expect(text).toContain('reward_delivery_failed')
    expect(text).toContain('理由を確認できませんでした')
  })

  it('失敗中でない交換は並べない', async () => {
    stubFetch({
      itemsByAccount: {
        'account-1': [
          failedRow(),
          failedRow({ id: 'r-ok', rewardName: '成功した交換', status: 'succeeded' }),
          failedRow({ id: 'r-refunded', rewardName: '返金済みの交換', status: 'refunded' }),
        ],
      },
    })
    await render('account-1')

    const text = section()?.textContent ?? ''
    expect(text).toContain('500円引き')
    expect(text).not.toContain('成功した交換')
    expect(text).not.toContain('返金済みの交換')
  })

  it('送ったか分からない交換は確認中として並べる', async () => {
    stubFetch({
      itemsByAccount: {
        'account-1': [
          failedRow(),
          failedRow({ id: 'r-hold', rewardName: '結果待ちの交換', status: 'delivering' }),
        ],
      },
    })
    await render('account-1')

    const text = section()?.textContent ?? ''
    expect(text).toContain('500円引き')
    expect(text).toContain('結果待ちの交換')
    expect(text).toContain('確認中')
    expect(text).toContain('届いていない')
  })

  it('1件も無いときは欄ごと出さない', async () => {
    stubFetch({ itemsByAccount: { 'account-1': [] } })
    await render('account-1')
    expect(section()).toBeNull()
  })

  it('同時クリックでもやり直しは1回しか送らない', async () => {
    let releaseRetry!: () => void
    const gate = new Promise<void>((resolve) => { releaseRetry = resolve })
    const net = stubFetch({
      itemsByAccount: { 'account-1': [failedRow(), failedRow({ id: 'redemption-2' })] },
      onRetry: async () => {
        await gate
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
      },
    })
    await render('account-1')

    const buttons = retryButtons()
    expect(buttons).toHaveLength(2)
    // 同じ行を連打し、続けて別の行も押す。応答が返る前の同時押し。
    await act(async () => {
      buttons[0].click()
      buttons[0].click()
      buttons[1].click()
    })
    expect(net.retries()).toHaveLength(1)
    expect(net.retries()[0].url).toContain('/redemption-1/retry-fulfillment')
    // 押した店を本文に添える。添えないと別の店の交換に当たる。
    expect(net.retries()[0].body).toBe(JSON.stringify({ accountId: 'account-1' }))
    // 応答が返るまで、どのボタンも押せない。
    expect(retryButtons().every((button) => button.disabled)).toBe(true)

    await act(async () => { releaseRetry(); await Promise.resolve() })
    // 返ったら一覧を読み直す（最初の1回＋やり直し後の1回）。
    expect(net.lists().length).toBeGreaterThanOrEqual(2)
  })

  it('やり直しが失敗したら断りを出し、もう一度押せる', async () => {
    const net = stubFetch({
      itemsByAccount: { 'account-1': [failedRow()] },
      onRetry: async (calls) => (calls === 1
        ? new Response(JSON.stringify({ success: false, error: 'まだやり直せません' }), { status: 409 })
        : new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })),
    })
    await render('account-1')

    await act(async () => { retryButtons()[0].click() })
    await act(async () => { await Promise.resolve() })
    expect(section()?.textContent ?? '').toContain('やり直せませんでした')
    expect(retryButtons().some((button) => button.disabled)).toBe(false)

    await act(async () => { retryButtons()[0].click() })
    await act(async () => { await Promise.resolve() })
    expect(net.retries()).toHaveLength(2)
  })

  it('店を替えたら前の店の交換は残らない', async () => {
    stubFetch({
      itemsByAccount: {
        'account-1': [failedRow({ rewardName: 'Aの500円引き' })],
        'account-2': [failedRow({ id: 'redemption-9', rewardName: 'Bの1000円引き' })],
      },
    })
    await render('account-1')
    expect(section()?.textContent ?? '').toContain('Aの500円引き')

    await render('account-2')
    const text = section()?.textContent ?? ''
    expect(text).toContain('Bの1000円引き')
    expect(text).not.toContain('Aの500円引き')
  })

  it('店が未選択なら交換を読まない', async () => {
    const net = stubFetch({ itemsByAccount: {} })
    await render(null)
    expect(section()).toBeNull()
    expect(net.lists()).toHaveLength(0)
  })

  it('25件あれば残りをページ送りで出せる', async () => {
    const items = Array.from({ length: 25 }, (_, index) => failedRow({
      id: `redemption-${index + 1}`,
      rewardName: index === 0 ? '最初の交換' : `交換${index + 1}`,
      updatedAt: '2026-09-09T01:02:03.000Z',
    }))
    items[20] = failedRow({ id: 'redemption-21', rewardName: '21件目の交換' })
    stubFetch({ itemsByAccount: { 'account-1': items } })
    await render('account-1')

    // 1ページ目は20件まで。「すべて」とは言わない。
    const first = section()?.textContent ?? ''
    expect(first).toContain('最初の交換')
    expect(first).not.toContain('21件目の交換')
    expect(first).toContain('25つ中')
    expect(first).not.toContain('すべて表示')

    // 2ページ目へ進むと残りが出る。
    const next = [...(section()?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.includes('次へ'))
    expect(next).toBeDefined()
    await act(async () => { next?.click() })
    await act(async () => { await Promise.resolve() })
    const second = section()?.textContent ?? ''
    expect(second).toContain('21件目の交換')
    expect(second).toContain('25つ中')
  })

  it('読み込み失敗は0件と区別し、再読み込みできる', async () => {
    let failLists = true
    stubFetch({
      itemsByAccount: { 'account-1': [failedRow()] },
      onList: () => (failLists
        ? new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 200 })
        : null),
    })
    await render('account-1')

    // 欄ごと消えず、理由が見える。0件と誤認しない。
    expect(section()).not.toBeNull()
    const text = section()?.textContent ?? ''
    expect(text).toContain('読み込めませんでした')
    expect(text).not.toContain('500円引き')

    // 直ったら再読み込みで正常に戻る。
    failLists = false
    const retry = [...(section()?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.includes('もう一度読み込む'))
    await act(async () => { retry?.click() })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(section()?.textContent ?? '').toContain('500円引き')
  })

  it('返却が完了したら返却どおりに案内し、古い行を外す', async () => {
    const items = [failedRow()]
    stubFetch({
      itemsByAccount: { 'account-1': items },
      onRetry: async () => {
        items.length = 0
        return new Response(JSON.stringify({
          success: false,
          data: {
            message: '特典を渡せなかったため、交換したマイルを戻しました。',
            redemption: { status: 'refunded' },
          },
        }), { status: 202 })
      },
    })
    await render('account-1')
    expect(section()?.textContent ?? '').toContain('500円引き')

    await act(async () => { retryButtons()[0].click() })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    // 「やり直せませんでした」と未返却の説明は残さない。
    const body = container.textContent ?? ''
    expect(body).toContain('マイルを戻しました')
    expect(body).not.toContain('やり直せませんでした')
    // 古い再試行の行は外れる。
    expect(section()).toBeNull()
  })
})
