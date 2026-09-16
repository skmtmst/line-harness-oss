// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- 実DOMと遅延応答を最小mockで対照する */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ accountId: 'account-1' }))
const apiMocks = vi.hoisted(() => ({ runDetail: vi.fn(), retryRun: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=run-1') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.accountId, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/shared/button', () => ({ default: ({ children, ...props }: any) => <button {...props}>{children}</button> }))
vi.mock('@/components/shared/list-state', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock('@/components/shared/status-badge', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/lib/api', () => ({ api: { friendAddRules: apiMocks } }))

const { default: FriendAddRunDetailPage } = await import('./page')

function detail(account: string) {
  return {
    success: true,
    data: {
      id: 'run-1', receivedAt: '2026-09-16T10:00:00+09:00', processedAt: null,
      friend: { id: `${account}-friend`, displayName: `${account}の顧客`, redacted: false },
      friendKind: 'first_time',
      attribution: { status: 'unavailable', routeId: null, routeName: null, reason: null },
      rule: { id: 'rule-1', name: '初回案内', versionId: 'v1', versionNumber: 1 },
      actionRuns: [
        { id: 'a1', stableId: 'v1:0', type: 'tag', status: 'completed', attemptCount: 1, nextRetryAt: null, errorCode: null, startedAt: 'x', completedAt: 'y', updatedAt: 'y' },
        { id: 'a2', stableId: 'v1:1', type: 'mile', status: 'failed', attemptCount: 1, nextRetryAt: null, errorCode: 'raw secret from provider', startedAt: 'x', completedAt: 'y', updatedAt: 'y' },
      ],
      status: 'partial_failed', errorCode: 'action_failed',
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.accountId = 'account-1'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  apiMocks.runDetail.mockImplementation(async (accountId: string) => detail(accountId))
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
  })
}

describe('N-103 friend-add run detail', () => {
  it('全処理を表示し、raw errorを隠して失敗がある時だけ再試行を出す', async () => {
    await render()
    expect(host.textContent).toContain('1. タグ操作')
    expect(host.textContent).toContain('2. マイル付与')
    expect(host.textContent).not.toContain('raw secret from provider')
    const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('失敗した1件だけ再試行'))
    expect(retry).toBeTruthy()
    await act(async () => { retry?.click(); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(apiMocks.retryRun).toHaveBeenCalledWith('account-1', 'run-1')
  })

  it('失敗がない実行には再試行を出さない', async () => {
    apiMocks.runDetail.mockResolvedValue({
      ...detail('account-1'),
      data: { ...detail('account-1').data, actionRuns: [detail('account-1').data.actionRuns[0]], status: 'completed' },
    })
    await render()
    expect(host.textContent).not.toContain('失敗した1件だけ再試行')
  })

  it('処理再試行が成功しても送信失敗が残る実行を完了表示にしない', async () => {
    apiMocks.runDetail.mockResolvedValue({
      ...detail('account-1'),
      data: {
        ...detail('account-1').data,
        actionRuns: [detail('account-1').data.actionRuns[0]],
        status: 'partial_failed',
        errorCode: 'send_failed',
      },
    })
    await render()
    expect(host.textContent).toContain('一部失敗')
    expect(host.textContent).not.toContain('失敗した1件だけ再試行')
  })

  it('account切替後は遅れて返った前accountの詳細を捨てる', async () => {
    let resolveOld!: (value: unknown) => void
    apiMocks.runDetail.mockImplementation((accountId: string) => accountId === 'account-1'
      ? new Promise((resolve) => { resolveOld = resolve })
      : Promise.resolve(detail(accountId)))

    await act(async () => {
      root.render(<FriendAddRunDetailPage />)
      await Promise.resolve()
    })
    state.accountId = 'account-2'
    await act(async () => {
      root.render(<FriendAddRunDetailPage />)
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(host.textContent).toContain('account-2の顧客')

    await act(async () => {
      resolveOld(detail('account-1'))
      await Promise.resolve()
    })
    expect(host.textContent).toContain('account-2の顧客')
    expect(host.textContent).not.toContain('account-1の顧客')
  })
})
