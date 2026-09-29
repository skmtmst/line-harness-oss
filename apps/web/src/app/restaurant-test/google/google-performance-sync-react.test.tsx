// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ★V6 GB-9: パフォーマンスの手動取り込み。
 *
 * つないだ直後は自動取得がまだ一度も走っておらず、画面が「—」のままで
 * 何も確かめられなかった（本番で実際に起きた）。Worker側には取り込みの
 * 入口があるのに画面から呼べていなかったので、ボタンを足した。
 *
 * 押さえる契約:
 *  1. ボタンを押すと取り込みを呼び、そのあと表示を読み直す
 *  2. 取り込み中は二度押しできない
 *  3. 失敗したら日本語の理由を画面に出し、内部文言を出さない
 *  4. 未取得の案内は、待つ以外の手段があることを伝える
 */

const perf = vi.hoisted(() => ({
  loadCalls: [] as number[],
  syncCalls: 0,
  syncError: null as Error | null,
  data: {} as Record<string, unknown>,
}))

vi.mock('@/lib/restaurant-google-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/restaurant-google-api')>('@/lib/restaurant-google-api')
  return {
    ...actual,
    restaurantGoogleApi: {
      ...actual.restaurantGoogleApi,
      performance: vi.fn(async (_accountId: string, days: number) => {
        perf.loadCalls.push(days)
        return { ...perf.data, days }
      }),
      syncPerformance: vi.fn(async () => {
        perf.syncCalls += 1
        if (perf.syncError) throw perf.syncError
        return { success: true as const, synced: 1, skipped: 0, failed: 0, syncedAt: '2026-09-29T14:30:00.000Z' }
      }),
    },
  }
})

const { ApiError } = await import('@/lib/api')
const { PerformanceTab } = await import('./google-performance')

const SAMPLE = {
  success: true,
  days: 28,
  range: { startDate: '2026-08-31', endDate: '2026-09-27' },
  previousRange: { startDate: '2026-08-03', endDate: '2026-08-30' },
  totals: { impressions: null, directionRequests: null, callClicks: null, websiteClicks: null },
  previousTotals: { impressions: null, directionRequests: null, callClicks: null, websiteClicks: null },
  daily: [],
  food: { menuClicks: null, bookings: null, foodOrders: null },
  lastMetricsSyncedAt: null,
}

let container: HTMLDivElement
let root: Root

async function render() {
  await act(async () => {
    root.render(<PerformanceTab accountId="account-2" />)
  })
}

function syncButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((element) => (element.textContent ?? '').includes('いま取り込む') || (element.textContent ?? '').includes('取り込み中'))
  if (!button) throw new Error('取り込みボタンが見つかりません')
  return button as HTMLButtonElement
}

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  perf.loadCalls = []
  perf.syncCalls = 0
  perf.syncError = null
  perf.data = { ...SAMPLE }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('GB-9 パフォーマンスの手動取り込み', () => {
  it('未取得のときは、待つ以外の手段があると伝える', async () => {
    await render()
    const text = container.textContent ?? ''
    expect(text).toContain('自動取得はまだ実行されていません')
    expect(text).toContain('いま取り込む')
  })

  it('押すと取り込みを呼び、そのあと表示を読み直す', async () => {
    await render()
    expect(perf.loadCalls).toHaveLength(1)

    await act(async () => { syncButton().click() })

    expect(perf.syncCalls).toBe(1)
    expect(perf.loadCalls).toHaveLength(2)
  })

  it('取り込み中は二度押しできない', async () => {
    let release = () => {}
    perf.syncError = null
    const gate = new Promise<void>((resolve) => { release = resolve })
    const api = await import('@/lib/restaurant-google-api')
    vi.mocked(api.restaurantGoogleApi.syncPerformance).mockImplementationOnce(async () => {
      perf.syncCalls += 1
      await gate
      return { success: true as const, synced: 1, skipped: 0, failed: 0, syncedAt: '2026-09-29T14:30:00.000Z' }
    })

    await render()
    await act(async () => { syncButton().click() })

    expect(syncButton().disabled).toBe(true)
    expect(syncButton().textContent).toContain('取り込み中')

    await act(async () => { release() })
    expect(perf.syncCalls).toBe(1)
  })

  it('失敗したら日本語の理由を出し、内部文言は出さない', async () => {
    perf.syncError = new ApiError(503, undefined, 'rate_limited')
    await render()
    await act(async () => { syncButton().click() })

    const text = container.textContent ?? ''
    expect(text).toContain('Googleから数値を取り込めませんでした。')
    expect(text).toContain('しばらく待ってから')
    expect(text).not.toContain('API error')
  })

  it('取り込みに失敗しても、画面は開いたままにする', async () => {
    perf.syncError = new ApiError(502, undefined, 'unavailable')
    await render()
    await act(async () => { syncButton().click() })

    const text = container.textContent ?? ''
    expect(text).toContain('プロフィール表示の推移')
    expect(syncButton().disabled).toBe(false)
  })
})
