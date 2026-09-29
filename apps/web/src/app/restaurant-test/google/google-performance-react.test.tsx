// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ★V6 GB-9: パフォーマンス画面を本物のReactで固定する。
 *
 * 押さえる契約:
 *  1. 主要4指標と前期比が出る（前期が無い指標は「前のN日比 —」）
 *  2. 未取得は「—」で出す（0件と区別。飲食店向けの未対応指標が対象）
 *  3. 期間を切り替えるとAPIへ days が渡る
 *  4. 設計の注記文言（Google提供・遅れ・電話クリックの但し書き）を消さない
 */

const perf = vi.hoisted(() => ({
  calls: [] as number[],
  data: {} as Record<string, unknown>,
}))

vi.mock('@/lib/restaurant-google-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/restaurant-google-api')>('@/lib/restaurant-google-api')
  return {
    ...actual,
    restaurantGoogleApi: {
      ...actual.restaurantGoogleApi,
      performance: vi.fn(async (_accountId: string, days: number) => {
        perf.calls.push(days)
        return { ...perf.data, days }
      }),
    },
  }
})

const { PerformanceTab } = await import('./google-performance')

const SAMPLE = {
  success: true,
  days: 28,
  range: { startDate: '2026-08-31', endDate: '2026-09-27' },
  previousRange: { startDate: '2026-08-03', endDate: '2026-08-30' },
  totals: { impressions: 2340, directionRequests: 184, callClicks: 42, websiteClicks: 96 },
  previousTotals: { impressions: 2082, directionRequests: 170, callClicks: null, websiteClicks: 87 },
  daily: Array.from({ length: 28 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    impressions: index < 27 ? 10 + index : null,
  })),
  food: { menuClicks: 76, bookings: null, foodOrders: null },
  lastMetricsSyncedAt: '2026-09-28T03:05:00.000Z',
}

let container: HTMLDivElement
let root: Root

async function render() {
  await act(async () => {
    root.render(<PerformanceTab accountId="account-2" />)
  })
}

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  perf.calls = []
  perf.data = { ...SAMPLE }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('GB-9 パフォーマンス', () => {
  it('主要4指標・前期比・期間・注記を出す', async () => {
    await render()
    const text = container.textContent ?? ''
    expect(text).toContain('プロフィール表示')
    expect(text).toContain('2,340')
    expect(text).toContain('ルート検索')
    expect(text).toContain('電話ボタンのクリック')
    expect(text).toContain('サイトへのクリック')
    expect(text).toContain('前の28日比 +12.4%')
    // 前期が未取得の指標は比較しない
    expect(text).toContain('前の28日比 —')
    expect(text).toContain('2026/08/31–09/27')
    expect(text).toContain('Google提供の集計値です')
    expect(text).toContain('電話のクリック数は、通話成立数ではありません')
    expect(text).toContain('プロフィール表示の推移')
    expect(text).toContain('未取得・未対応は「—」で表示し、0件と区別します')
  })

  it('未対応の飲食店向け指標は「—」で出す', async () => {
    await render()
    const text = container.textContent ?? ''
    expect(text).toContain('メニュー閲覧')
    expect(text).toContain('76')
    expect(text).toContain('Google経由の予約')
    expect(text).toContain('料理の注文')
    expect(text).toContain('連携サービス未対応')
    expect(text).toContain('—')
  })

  it('期間の切り替えでAPIへ days を渡す', async () => {
    await render()
    expect(perf.calls).toEqual([28])
    const select = container.querySelector('[aria-label="集計期間"]')
    expect(select).not.toBeNull()
  })
})
