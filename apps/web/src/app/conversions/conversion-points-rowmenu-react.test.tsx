// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversionsPage from './page'

/*
 * R280: 成果地点の一覧で行の「…」を開くと、メニューが二重に出ていた。
 *
 * 原因は `pointMenuId` をスマホカードとPC表の両方の ActionMenu で
 * 共有していたこと。隠れている側の器（MenuPortal）も body へ出るため、
 * 左上(8,4)に亡霊のメニューが現れ、外側クリックの処理が互いを閉じて
 * 詳細へ進めなかった。
 *
 * 直し：行ごとに独立した開閉（共通 RowActions）へ戻す。見るのは文字列
 * ではなく body に出た `[role="menu"]` の数と、開いた先の詳細の有無。
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => 'points',
}))

const DEFINITION = {
  id: 'point-a',
  name: '購入',
  sourceType: 'ec_order_confirmed',
  value: 100,
  measureMethod: 'webhook',
  targetUrl: null,
  countRepeat: true,
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
    recordedCount: 5, netCount: 5, reversedCount: null, netValue: 500,
    reversalState: 'unavailable', reversalReason: '', cancellationCount: null, cancellationValue: null,
  },
  stoppedAt: null,
  createdAt: '2026-09-01T00:00:00.000+09:00',
  updatedAt: '2026-09-01T00:00:00.000+09:00',
}

function listBody() {
  return {
    success: true,
    data: {
      items: [DEFINITION],
      stateCounts: { active: 1, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0, unused: 0 },
      range: { from: '2026-09-01 00:00:00', to: '2026-09-30 23:59:59', timeZone: 'Asia/Tokyo' },
      pagination: { total: 1, limit: 50, cursor: '0', nextCursor: null },
    },
  }
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    if (path.startsWith('/api/conversions/definitions')) {
      return new Response(JSON.stringify(listBody()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (path.startsWith('/api/conversions/report') || path.startsWith('/api/conversions/definition-report')) {
      return new Response(JSON.stringify({ success: true, data: { kpis: {}, daily: [], byDefinition: [], byRoute: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

let container: HTMLDivElement
let root: Root

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(ConversionsPage)) })
  await act(async () => { await Promise.resolve() })
}

function menus(): HTMLElement[] {
  return [...document.body.querySelectorAll('[role="menu"]')] as HTMLElement[]
}

function byText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')]
    .find((node) => node.textContent?.trim() === text) as HTMLButtonElement | undefined
}

function moreButtons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll('button[aria-label="購入のその他操作"]')]
    .filter((node) => node.isConnected) as HTMLButtonElement[]
}

async function click(node: HTMLElement | undefined) {
  expect(node, '押せる要素が見つかりません').toBeTruthy()
  await act(async () => { node!.click() })
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  installFetch()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

describe('R280 成果地点の操作メニューは1つだけ', () => {
  it('「…」を開いても可視メニューは1つだけ', async () => {
    await mount()
    expect(moreButtons().length).toBeGreaterThan(0)
    // PC表・スマホカードのどちらか片方を開く。共有状態のままだと両方が開く。
    await click(moreButtons()[0])
    expect(menus()).toHaveLength(1)
  })

  it('クリックで詳細が開く', async () => {
    await mount()
    await click(moreButtons()[0])
    await click(byText('中身を見る'))
    // 詳細の窓が開いた（閉じる×と成果地点の数え方が見える）。
    expect(document.body.querySelector('button[aria-label="閉じる"]')).toBeTruthy()
    expect(document.body.textContent).toContain('この成果地点の数え方と利用状況です。')
  })

  it('Escapeでメニューが閉じ、詳細は開かない', async () => {
    await mount()
    await click(moreButtons()[0])
    expect(menus()).toHaveLength(1)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })
    expect(menus()).toHaveLength(0)
    expect(document.body.textContent).not.toContain('この成果地点の数え方と利用状況です。')
  })

  it('行をクリックしても詳細が開く', async () => {
    await mount()
    const row = document.body.querySelector('tbody tr')
    expect(row, '一覧の行が見つかりません').toBeTruthy()
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain('この成果地点の数え方と利用状況です。')
  })
})
