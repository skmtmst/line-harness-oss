// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- 実DOMと失敗応答を最小mockで対照する */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ accountId: 'account-1', params: 'id=run-1' }))
const apiMocks = vi.hoisted(() => ({ runDetail: vi.fn(), retryRun: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.params) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.accountId, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/shared/button', () => ({ default: ({ children, ...props }: any) => <button {...props}>{children}</button> }))
vi.mock('@/components/shared/status-badge', () => ({ default: ({ children }: { children: React.ReactNode }) => <span data-badge>{children}</span> }))
vi.mock('@/lib/api', () => ({ api: { friendAddRules: apiMocks } }))

const { default: FriendAddRunDetailPage } = await import('./page')

function statusError(status: number, message?: string) {
  return { status, message: message ?? `API error: ${status}` }
}

function detail() {
  return {
    success: true,
    data: {
      id: 'run-1', receivedAt: '2026-09-16T10:00:00+09:00', processedAt: null,
      friend: { id: 'account-1-friend', displayName: 'テスト顧客', redacted: false },
      friendKind: 'first_time',
      attribution: { status: 'unavailable', routeId: null, routeName: null, reason: null },
      rule: { id: 'rule-1', name: '初回案内', versionId: 'v1', versionNumber: 1 },
      actionRuns: [
        { id: 'a1', stableId: 'v1:0', type: 'tag', status: 'completed', attemptCount: 1, nextRetryAt: null, errorCode: null, startedAt: 'x', completedAt: 'y', updatedAt: 'y' },
        { id: 'a2', stableId: 'v1:1', type: 'mile', status: 'failed', attemptCount: 1, nextRetryAt: null, errorCode: 'action_failed', startedAt: 'x', completedAt: 'y', updatedAt: 'y' },
      ],
      status: 'partial_failed', errorCode: 'action_failed',
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.accountId = 'account-1'
  state.params = 'id=run-1'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  apiMocks.runDetail.mockImplementation(async () => detail())
  apiMocks.retryRun.mockResolvedValue({ success: true, data: { status: 'completed', retried: 1 } })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.clearAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<FriendAddRunDetailPage />)
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  })
}

function retryButton(): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('だけ再試行')) as HTMLButtonElement | undefined
}

async function clickRetry() {
  const retry = retryButton()
  expect(retry).toBeTruthy()
  await act(async () => {
    retry?.click()
    // 再試行→失敗文→409なら読み直し、まで非同期が何段も続くので回す。
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

/**
 * M010: 実行詳細の読み込み403で権限不足と分からない。
 * M011: 失敗処理の再試行の結果が一律で、権限・対象なし・二重送を区別しない。
 */
describe('M010/M011 実行詳細の読み込み・再試行の失敗（本物のReact）', () => {
  it('M010: 読み込み403は権限不足と分かる', async () => {
    apiMocks.runDetail.mockRejectedValue(statusError(403))
    await render()
    const text = host.textContent ?? ''
    expect(text).toContain('権限')
    expect(text).not.toContain('通信が切れた')
  })

  it('M011: 再試行の403は権限の確認を案内する', async () => {
    await render()
    expect(host.textContent ?? '').toContain('テスト顧客')
    apiMocks.retryRun.mockRejectedValue(statusError(403))
    await clickRetry()
    const text = host.textContent ?? ''
    expect(text).toContain('再試行する権限がありません')
  })

  it('M011: 再試行の409はサーバの理由を出し、読み直して今を見る', async () => {
    await render()
    apiMocks.retryRun.mockRejectedValue(
      statusError(409, '再試行できる失敗処理がないか、すでに再試行中です'),
    )
    await clickRetry()
    expect(host.textContent ?? '').toContain('すでに再試行中です')
    // 409 は実際は通っていることがあるので、読み直して今の状態を出す。
    expect(apiMocks.runDetail.mock.calls.length).toBeGreaterThan(1)
  })

  it('M011: 再試行の通信断は通信の確認を案内する', async () => {
    await render()
    apiMocks.retryRun.mockRejectedValue(new TypeError('fetch failed'))
    await clickRetry()
    expect(host.textContent ?? '').toContain('通信を確認して')
  })
})
