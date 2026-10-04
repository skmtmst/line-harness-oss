// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversionsPage from './page'

/*
 * R595/R596: 一覧と集計は別々に失敗する。失敗した側だけを未取得として
 * 示し、読めた側は残す。どちらも「0」とは言わない。
 *
 * - R595: 一覧だけ503・集計は200。一覧の失敗は失敗パネル＋再試行に出し、
 *   数値カード・絞り込み札・フッターの件数に 0 を出さない。集計由来の
 *   金額の説明も「0個の成果地点」と誤らない。再試行で6件/4個へ戻る。
 * - R596: 一覧は200・集計だけ503。一覧の行は残し、「この30日の成果」
 *   カードだけ失敗と再試行にする。再試行は集計だけ読み直す。
 */

const mode = vi.hoisted(() => ({
  list: 'ok' as 'ok' | 'error',
  report: 'ok' as 'ok' | 'error',
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => 'points',
}))

const NAMES = ['購入A', '購入B', '購入C', '購入D', '購入E', '購入F']
/** 6件のうち4件に金額あり。R595の「正しい6件/4個」のもと。 */
const VALUES: Array<number | null> = [100, 200, 300, 400, null, null]

function definition(index: number) {
  return {
    id: `point-${index}`,
    name: NAMES[index],
    sourceType: 'ec_order_confirmed',
    value: VALUES[index],
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
      netValue: VALUES[index] ?? 0,
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
      items: [0, 1, 2, 3, 4, 5].map(definition),
      stateCounts: { active: 6, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0, unused: 0 },
      range: { from: '2026-09-01', to: '2026-09-30', timeZone: 'Asia/Tokyo' },
      pagination: { total: 6, limit: 100, cursor: '0', nextCursor: null },
    },
  }
}

function reportBody() {
  return {
    success: true,
    data: {
      range: { from: '2026-09-01', to: '2026-09-30', timeZone: 'Asia/Tokyo' },
      previousRange: { from: '2026-08-02', to: '2026-08-31', timeZone: 'Asia/Tokyo' },
      kpis: {
        recordedCount: 30,
        recordedValue: 3000,
        reversedCount: 0,
        netCount: 30,
        netValue: 3000,
        averageNetValue: 100,
        previousNetCount: 20,
        previousNetValue: 2000,
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

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    if (path.startsWith('/api/conversions/definitions')) {
      return mode.list === 'ok'
        ? jsonResponse(listBody(), 200)
        : jsonResponse({ success: false, error: 'audit list 503' }, 503)
    }
    if (path.startsWith('/api/conversions/report')) {
      return mode.report === 'ok'
        ? jsonResponse(reportBody(), 200)
        : jsonResponse({ success: false, error: 'audit report 503' }, 503)
    }
    return jsonResponse({ success: true, data: {} }, 200)
  })
}

let container: HTMLDivElement
let root: Root

async function flush(times = 10) {
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

function clickByText(text: string) {
  const node = [...container.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === text) as HTMLButtonElement | undefined
  expect(node, `押せる要素が見つかりません: ${text}`).toBeTruthy()
  return (async () => {
    await act(async () => { node!.click() })
    await flush()
  })()
}

beforeEach(() => {
  mode.list = 'ok'
  mode.report = 'ok'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  installFetch()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

describe('R595 一覧だけ失敗しても0件と誤らない', () => {
  it('失敗パネルと再試行を出し、件数に0を出さない', async () => {
    mode.list = 'error'
    await mount()
    const text = container.textContent ?? ''
    // 一覧の失敗は失敗パネルが担う。
    expect(text).toContain('成果地点を読み込めませんでした')
    expect(container.querySelector('table')).toBeNull()
    // 未取得を0と誤らない（札・フッター・集計の説明）。
    expect(text).not.toContain('すべて 0')
    expect(text).not.toContain('成果地点 0件')
    expect(text).not.toContain('0個の成果地点で金額を記録')
    expect(text).toContain('金額の内訳を読み込めませんでした')
    expect(text).toContain('一覧を読み込めませんでした')
  })

  it('再試行で正しい6件と4個へ戻る', async () => {
    mode.list = 'error'
    await mount()
    expect(container.querySelector('table')).toBeNull()
    mode.list = 'ok'
    await clickByText('もう一度試す')
    const text = container.textContent ?? ''
    expect(container.querySelector('table')).not.toBeNull()
    expect(text).toContain('購入A')
    expect(text).toContain('4個の成果地点で金額を記録')
    expect(text).not.toContain('成果地点を読み込めませんでした')
  })
})

describe('R596 集計だけ失敗しても一覧は残す', () => {
  it('行は残し、集計カードだけ失敗と再試行にする', async () => {
    mode.report = 'error'
    await mount()
    const text = container.textContent ?? ''
    // 一覧は読めているので行が残る。
    expect(container.querySelector('table')).not.toBeNull()
    expect(text).toContain('購入A')
    expect(text).toContain('4個の成果地点で金額を記録')
    // 集計の失敗は数値カードに出る。
    expect(text).toContain('この30日の集計を読み込めませんでした')
    expect(text).not.toContain('前の30日 20件')
  })

  it('集計の再試行で行を消さず数値へ戻す', async () => {
    mode.report = 'error'
    await mount()
    expect((container.textContent ?? '')).toContain('この30日の集計を読み込めませんでした')
    mode.report = 'ok'
    await clickByText('集計を再読み込み')
    const text = container.textContent ?? ''
    expect(text).toContain('前の30日 20件')
    expect(text).not.toContain('この30日の集計を読み込めませんでした')
    // 再試行のあいだも行は残る。
    expect(container.querySelector('table')).not.toBeNull()
    expect(text).toContain('購入A')
  })
})

describe('R595/R596 正常時は失敗を出さない', () => {
  it('両方200なら件数と集計が出て失敗文は無い', async () => {
    await mount()
    const text = container.textContent ?? ''
    expect(text).toContain('購入A')
    expect(text).toContain('4個の成果地点で金額を記録')
    expect(text).toContain('前の30日 20件')
    expect(text).not.toContain('読み込めませんでした')
  })
})
