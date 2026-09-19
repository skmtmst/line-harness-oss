// @vitest-environment happy-dom
/*
 * 動いた記録の「もう一度やる」を本物の React で押し、受け付け案内を確かめる(#736)。
 * 一覧の初回取得は400ms待ちのため、偽タイマーで確定的に進める（実時間の待ちなし）。
 * 見る筋書き:
 *   1. 再送を受け付けたら「再実行を受け付けました。結果は実行記録で確認してください」と出て、
 *      一覧を再取得する（ポーリングはしない。fetch の回数で見る）。
 *   2. 409 では失敗文が出て、実行しましたとは言わない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchApi = vi.hoisted(() => vi.fn())
const api = vi.hoisted(() => ({
  automations: {
    // #942 N-353/N-354: 詳細の読み直し・CSV口・取りやめ。
    getRun: vi.fn(async () => ({ success: true as const, data: null })),
    cancelRun: vi.fn(),
    runsCsvUrl: vi.fn(() => 'http://worker.test/api/automation-runs?format=csv'),
  },
}))
vi.mock('@/lib/api', () => ({ fetchApi, api }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/automations/runs',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

import AutomationRunsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function runRow() {
  return {
    id: 'run-1',
    occurredAt: '2026-09-14T01:00:00.000Z',
    subject: '田中さん',
    accountLabel: '本店',
    triggerLabel: 'メッセージが届いたとき',
    status: 'permanent_failed',
    detail: '失敗しました',
    durationMs: 1200,
    automationName: '予約案内',
    canRetry: true,
    versionNumber: 3,
    isTest: false,
    canCancel: false,
  }
}

function listResponse() {
  return {
    success: true,
    data: {
      summary: {
        total: 1, executed: 1, skipped: 0, failed: 1, mostRunName: '予約案内', mostRunCount: 1,
      },
      items: [runRow()],
      pagination: { total: 1, limit: 20, offset: 0 },
    },
  }
}

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderPage() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<AutomationRunsPage />)
  })
  // 初回取得の400ms待ちを進め、応答の描画まで流す。
  await act(async () => {
    vi.advanceTimersByTime(1000)
  })
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
  vi.useRealTimers()
})

function retryButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
    .filter((button) => button.textContent === 'もう一度やる')
}

function listCalls(): unknown[][] {
  return fetchApi.mock.calls.filter(
    ([url]) => typeof url === 'string' && url.startsWith('/api/automation-runs?'),
  )
}

describe('動いた記録の再実行受け付け(#736)', () => {
  it('受け付けたら案内を出して一覧を再取得する', async () => {
    fetchApi.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (typeof url === 'string' && url.includes('/retry')) {
        expect(init?.method).toBe('POST')
        return { success: true, data: { runId: 'run-1', status: 'waiting' } }
      }
      return listResponse()
    })
    await renderPage()
    expect(listCalls().length).toBe(1)
    expect(retryButtons()).toHaveLength(1)

    await act(async () => {
      retryButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(container.textContent).toContain('再実行を受け付けました。結果は実行記録で確認してください')
    expect(container.textContent).not.toContain('もう一度実行しました')
    // 一覧の再取得（初回 + 再送後）。ポーリングはしないので3回以上にならない。
    expect(listCalls().length).toBe(2)
  })

  it('409では失敗文を出し、実行しましたとは言わない', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/retry')) {
        return { success: false, error: '失敗した処理がある実行だけ、もう一度実行できます' }
      }
      return listResponse()
    })
    await renderPage()

    await act(async () => {
      retryButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(container.textContent).toContain('失敗した処理がある実行だけ、もう一度実行できます')
    expect(container.textContent).not.toContain('受け付けました')
  })
})
