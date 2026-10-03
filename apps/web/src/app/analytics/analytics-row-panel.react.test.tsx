// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

/*
 * V8「サクサク感」C①②・D・E：分析（保存タブ・定期レポート）の一覧の行パネル。
 * 行を押すと右に詳細パネル（↑↓で次の行）。「内容を変える」は編集画面へ進む。
 * 名前のその場の書き換えは無し（名前は編集画面で変えるため）。
 */

const pushes: string[] = []
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push(url: string) { pushes.push(url) }, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/analytics',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => 'saved',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

function schedule(overrides: Record<string, unknown>) {
  return {
    id: 'report-1', lineAccountId: 'account-a', name: '週次まとめ',
    sections: ['friends'], savedAnalysisIds: ['saved-1'], cadence: 'weekly', weekday: 1,
    monthDay: null, sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
    recipients: [{ kind: 'staff', staffId: 'u-1', label: 'テスト' }],
    channels: ['dashboard'], alertRules: [], status: 'active',
    isOneTime: false, nextRunAt: '2026-09-21T00:00:00.000Z', createdBy: 'u-1',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const SAVED_ITEM = {
  id: 'saved-1', name: '流入別の成果', kind: 'cross', status: 'active',
  currentVersionNumber: 2, createdBy: 'u-1', createdByName: 'テスト',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  snapshotCount: 1,
  latestSnapshot: {
    id: 'snap-1', state: 'available', periodFrom: '2026-08-25', periodTo: '2026-09-01',
    dataCutoffAt: '2026-09-01T15:00:00.000Z', createdAt: '2026-09-01T15:00:00.000Z',
  },
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    let body: unknown
    if (path === '/api/staff/me') body = { success: true, data: { role: 'owner' } }
    else if (path.startsWith('/api/analytics/saved/saved-1/snapshots')) body = { success: true, data: [] }
    else if (path.startsWith('/api/analytics/saved')) body = { success: true, data: [SAVED_ITEM] }
    else if (path.startsWith('/api/analytics/report-schedules')) {
      body = {
        success: true,
        data: {
          items: [schedule({}), schedule({ id: 'report-2', name: '月次まとめ', cadence: 'monthly', monthDay: 1, weekday: null })],
          options: { timeZone: 'Asia/Tokyo', savedAnalyses: [], recipients: [] },
        },
      }
    }
    else body = { success: true, data: {} }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  pushes.length = 0
  document.documentElement.dataset.theme = 'v8'
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

async function openFirstRow() {
  await act(async () => { root.render(<AnalyticsPage />) })
  await eventually(() => {
    if (!host.textContent?.includes('週次まとめ')) throw new Error('row not loaded')
  })
  const rows = [...host.querySelectorAll('tbody tr')]
  const firstRow = rows.find((tr) => tr.textContent?.includes('週次まとめ'))
  if (!firstRow) throw new Error('no rows')
  await act(async () => {
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await Promise.resolve() })
}

describe('分析V8定期レポートの行パネル（C・D・E）', () => {
  it('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
    await openFirstRow()
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel || !panel.textContent?.includes('週次まとめ')) throw new Error('panel not open')
    })
    const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel?.textContent?.includes('月次まとめ')) throw new Error('did not move')
    })
  })

  it('パネルの「内容を変える」は編集画面へ進む', async () => {
    await openFirstRow()
    await eventually(() => {
      if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
    })
    const edit = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '内容を変える')
    if (!edit) throw new Error('no edit button')
    await act(async () => { edit.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(pushes).toEqual(['/analytics/reports/new?id=report-1'])
  })
})
