// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- 実DOMと遅延応答を最小mockで対照する */
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
vi.mock('@/components/shared/list-state', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock('@/components/shared/notice', () => ({ default: ({ children }: { children: React.ReactNode }) => <div role="note">{children}</div> }))
vi.mock('@/components/shared/status-badge', () => ({ default: ({ children }: { children: React.ReactNode }) => <span data-badge>{children}</span> }))
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
  state.params = 'id=run-1'
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
    // 一覧と同じ言葉で「再送待ち」を出す（R267）
    expect(host.textContent).toContain('再送待ち')
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

describe('R264〜R268 実行詳細', () => {
  it('R265: 受信日時・追加の種類・経路・適用ルールと版・記録IDを先頭に示す', async () => {
    apiMocks.runDetail.mockResolvedValue({
      success: true,
      data: {
        ...detail('account-1').data,
        processedAt: '2026-09-16T10:00:03+09:00',
        attribution: { status: 'captured', routeId: 'route-1', routeName: '紹介QR', reason: 'REF001' },
      },
    })
    await render()
    const text = host.textContent ?? ''
    expect(text).toContain('9月16日（水）10:00')
    expect(text).toContain('はじめて')
    expect(text).toContain('紹介QR')
    expect(text).toContain('初回案内・第1版')
    expect(text).toContain('run-1')
  })

  it('R267: 送達不明は「配信なし」に置き換わらず警告を優先する', async () => {
    apiMocks.runDetail.mockResolvedValue({
      success: true,
      data: { ...detail('account-1').data, status: 'suppressed', errorCode: 'delivery_unknown' },
    })
    await render()
    const text = host.textContent ?? ''
    expect(text).toContain('送達不明・要確認（自動では送り直しません）')
    // イベントの状態表示が「配信なし」に変わらない
    const badge = host.querySelector('[data-badge]')
    expect(badge?.textContent).toBe('送達不明')
  })

  it('R267: 配信なし（suppressed）の記録は一覧と同じ「配信なし」を出す', async () => {
    apiMocks.runDetail.mockResolvedValue({
      success: true,
      data: { ...detail('account-1').data, status: 'suppressed', errorCode: null },
    })
    await render()
    const badge = host.querySelector('[data-badge]')
    expect(badge?.textContent).toBe('配信なし')
  })

  it('R268: 一覧へ戻るリンクが受け取った絞り込みとページ位置を返す', async () => {
    state.params = 'id=run-1&kind=first_time&status=failed&attribution=captured&rule_id=rule-1&pages=cur-8%2Ccur-9'
    await render()
    const back = host.querySelector('a[href^="/friend-add-settings/runs?"]')
    expect(back).not.toBeNull()
    const href = back!.getAttribute('href')!
    for (const part of ['kind=first_time', 'status=failed', 'attribution=captured', 'rule_id=rule-1', 'pages=']) {
      expect(href).toContain(part)
    }
  })
})
