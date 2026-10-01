// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversionsPage from './page'

/*
 * R596 回帰：集計の再試行の応答が遅れたとき、切り替え後のアカウントの
 * 表示を上書きしない。成功・失敗どちらの遅延応答も捨てる。
 *
 * 再現：本店で集計503→「集計を再読み込み」を押す→応答より先に別
 * アカウントへ切り替える→別アカウントの正常な集計が出る→遅れた本店の
 * 応答が返る→切り替え後の表示が本店の数値で上書きされてしまう。
 * 世代番号とアカウントの照合で、遅れた応答は成功・失敗とも捨てる。
 */

const accountStore = vi.hoisted(() => ({ id: 'account-a' }))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: accountStore.id, loading: false }),
}))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => 'points',
}))

function definition() {
  return {
    id: 'point-0',
    name: '購入A',
    sourceType: 'ec_order_confirmed',
    value: 100,
    measureMethod: 'webhook',
    targetUrl: null,
    attributionDays: null,
    sourceConfig: {},
    deduplicationMode: 'every',
    deduplicationWindowDays: null,
    valueMode: 'fixed',
    reversalPolicy: 'manual',
    lineAccountId: 'account-a',
    status: 'active',
    state: 'active',
    stateReason: null,
    ingest: { configured: false, disabledAt: null },
    version: 3,
    usageCount: 1,
    usageNames: ['シナリオA'],
    metrics: {
      recordedCount: 5,
      netCount: 5,
      reversedCount: null,
      netValue: 100,
      reversalState: 'unavailable',
      reversalReason: '',
      cancellationCount: null,
      cancellationValue: null,
    },
    stoppedAt: null,
    createdAt: '2026-09-01T00:00:00.000+09:00',
    updatedAt: '2026-09-01T00:00:00.000+09:00',
  }
}

function listBody() {
  return {
    success: true,
    data: {
      items: [definition()],
      stateCounts: { active: 1, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0, unused: 0 },
      range: { from: '2026-09-01', to: '2026-09-30', timeZone: 'Asia/Tokyo' },
      pagination: { total: 1, limit: 100, cursor: '0', nextCursor: null },
    },
  }
}

function reportBody(options: { netCount: number; previousNetCount: number; netValue: number }) {
  return {
    success: true,
    data: {
      range: { from: '2026-09-01', to: '2026-09-30', timeZone: 'Asia/Tokyo' },
      previousRange: { from: '2026-08-02', to: '2026-08-31', timeZone: 'Asia/Tokyo' },
      kpis: {
        recordedCount: options.netCount,
        recordedValue: options.netValue,
        reversedCount: 0,
        netCount: options.netCount,
        netValue: options.netValue,
        averageNetValue: 100,
        previousNetCount: options.previousNetCount,
        previousNetValue: 1000,
        countChangeRate: 50,
        reversalState: 'unavailable',
        reversalReason: '',
        fastestGrowing: null,
        cancellationCount: null,
        cancellationValue: null,
      },
      daily: [],
      byDefinition: [],
      byRoute: [],
    },
  }
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let reportResponder: (accountId: string) => Promise<Response> | Response = () =>
  jsonResponse(reportBody({ netCount: 77, previousNetCount: 10, netValue: 770 }), 200)

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = String(input)
    const url = new URL(raw, 'http://localhost')
    if (url.pathname === '/api/conversions/definitions') {
      return jsonResponse(listBody(), 200)
    }
    if (url.pathname === '/api/conversions/report') {
      return reportResponder(url.searchParams.get('lineAccountId') ?? '')
    }
    return jsonResponse({ success: true, data: {} }, 200)
  })
}

let container: HTMLDivElement
let root: Root

async function flush(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(ConversionsPage)) })
  await flush()
}

async function rerender() {
  await act(async () => { root.render(React.createElement(ConversionsPage)) })
  await flush()
}

function findRetryButton() {
  return [...container.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === '集計を再読み込み') as HTMLButtonElement | undefined
}

beforeEach(() => {
  accountStore.id = 'account-a'
  reportResponder = () =>
    jsonResponse(reportBody({ netCount: 77, previousNetCount: 10, netValue: 770 }), 200)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  installFetch()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

describe('R596回帰 遅れた再試行の応答は捨てる', () => {
  it('遅れた旧アカウントの成功応答で新アカウントを上書きしない', async () => {
    let reportCalls = 0
    let resolveOld!: (response: Response) => void
    reportResponder = (accountId) => {
      if (accountId === 'account-a') {
        reportCalls += 1
        // 初回は503で再試行を出し、再試行の応答だけ遅延させる。
        if (reportCalls === 1) {
          return jsonResponse({ success: false, error: 'audit report 503' }, 503)
        }
        return new Promise<Response>((resolve) => { resolveOld = resolve })
      }
      return jsonResponse(reportBody({ netCount: 77, previousNetCount: 10, netValue: 770 }), 200)
    }
    await mount()
    expect(container.textContent ?? '').toContain('この30日の集計を読み込めませんでした')

    // 再試行を押して応答を遅延させたまま、アカウントを切り替える。
    const retry = findRetryButton()
    expect(retry, '集計の再試行が出ません').toBeTruthy()
    await act(async () => { retry!.click() })
    await flush()
    accountStore.id = 'account-b'
    await rerender()
    expect(container.textContent ?? '').toContain('前の30日 10件')

    // 遅れた旧アカウントの成功応答が返っても、表示は変わらない。
    await act(async () => {
      resolveOld(jsonResponse(reportBody({ netCount: 111111, previousNetCount: 99, netValue: 111111 }), 200))
    })
    await flush()
    const text = container.textContent ?? ''
    expect(text).toContain('前の30日 10件')
    expect(text).not.toContain('111')
    expect(text).not.toContain('この30日の集計を読み込めませんでした')
  })

  it('遅れた旧アカウントの失敗応答で新アカウントの成功を消さない', async () => {
    let reportCalls = 0
    let resolveOld!: (response: Response) => void
    reportResponder = (accountId) => {
      if (accountId === 'account-a') {
        reportCalls += 1
        if (reportCalls === 1) {
          return jsonResponse({ success: false, error: 'audit report 503' }, 503)
        }
        return new Promise<Response>((resolve) => { resolveOld = resolve })
      }
      return jsonResponse(reportBody({ netCount: 77, previousNetCount: 10, netValue: 770 }), 200)
    }
    await mount()
    expect(container.textContent ?? '').toContain('この30日の集計を読み込めませんでした')

    const retry = findRetryButton()
    expect(retry, '集計の再試行が出ません').toBeTruthy()
    await act(async () => { retry!.click() })
    await flush()
    accountStore.id = 'account-b'
    await rerender()
    expect(container.textContent ?? '').toContain('前の30日 10件')

    // 遅れた旧アカウントの失敗応答が返っても、成功表示は残る。
    await act(async () => {
      resolveOld(jsonResponse({ success: false, error: 'audit report 503' }, 503))
    })
    await flush()
    const text = container.textContent ?? ''
    expect(text).toContain('前の30日 10件')
    expect(text).not.toContain('この30日の集計を読み込めませんでした')
  })

  it('切り替えが無ければ再試行はそのまま直る', async () => {
    let reportCalls = 0
    reportResponder = () => {
      reportCalls += 1
      if (reportCalls === 1) {
        return jsonResponse({ success: false, error: 'audit report 503' }, 503)
      }
      return jsonResponse(reportBody({ netCount: 77, previousNetCount: 10, netValue: 770 }), 200)
    }
    await mount()
    expect(container.textContent ?? '').toContain('この30日の集計を読み込めませんでした')

    const retry = findRetryButton()
    expect(retry, '集計の再試行が出ません').toBeTruthy()
    await act(async () => { retry!.click() })
    await flush()
    const text = container.textContent ?? ''
    expect(text).toContain('前の30日 10件')
    expect(text).not.toContain('この30日の集計を読み込めませんでした')
    expect(container.querySelector('table')).not.toBeNull()
  })
})
