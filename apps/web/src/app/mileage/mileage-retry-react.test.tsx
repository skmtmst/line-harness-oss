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
}) {
  const calls: Call[] = []
  let retryCalls = 0
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
      const accountId = new URL(url, 'https://example.test').searchParams.get('accountId') ?? ''
      const items = options.itemsByAccount[accountId] ?? []
      return new Response(
        JSON.stringify({ success: true, data: { items, pagination: { total: items.length, limit: 20, offset: 0 } } }),
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
  return container.querySelector('section[aria-label="届かなかった交換"]')
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
})
