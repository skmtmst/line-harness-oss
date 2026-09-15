// @vitest-environment happy-dom
/*
 * 実行結果の「もう一度実行」を本物の React で押して確かめる（N-081）。
 * 見る筋書き:
 *   1. canRetry=true の行にだけ再実行ボタンが出る。
 *   2. 押すと POST が飛び、成功したら一覧を読み直す。
 *   3. 409 は「処理中または完了済み」の案内に読み替えて一覧を読み直す。
 *   4. 実行中はボタンを押せず、二度押しで二重に飛ばない。
 *   5. それ以外の失敗は既存のメッセージ領域に出す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockApiError extends Error {
    readonly status: number
    constructor(status: number, message?: string) {
      super(message ?? `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
    }
  }
  return { runs: vi.fn(), retryRun: vi.fn(), MockApiError }
})
const { runs: runsMock, retryRun: retryRunMock, MockApiError } = mocks

vi.mock('@/lib/api', () => ({
  api: {
    autoReplies: {
      runs: mocks.runs,
      retryRun: mocks.retryRun,
      update: vi.fn(),
    },
  },
  ApiError: mocks.MockApiError,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/auto-replies/runs',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: vi.fn(),
}))

import AutoReplyRunsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function runItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evaluation-1',
    ownerKind: 'auto_reply',
    ownerId: 'rule-1',
    lineAccountId: 'acc-1',
    occurredAt: '2026-09-15T01:00:00.000Z',
    subject: '田中さん',
    accountLabel: '本店',
    triggerLabel: '予約',
    reference: null,
    status: 'permanent_failed',
    detail: '返信または一部の処理だけ完了しました',
    durationMs: 800,
    canRetry: true,
    autoReplyId: 'rule-1',
    autoReplyName: '予約問い合わせ',
    friendId: 'friend-1',
    friendName: '田中さん',
    messageKind: 'text',
    inputPreview: '予約したい',
    matchedKeyword: '予約',
    versionNumber: 1,
    domainStatus: 'partial_failed',
    replyStatus: 'accepted',
    actionSummary: { executed: 1, failed: 1 },
    lineRequestId: 'line-request-1',
    ...overrides,
  }
}

function listResponse(items = [runItem()]) {
  return {
    success: true,
    data: {
      rule: { id: 'rule-1', name: '予約問い合わせ', isActive: true, priorityPosition: 1 },
      summary: { monthHits: 1, totalHits: 1, handovers: 0, errors: 1, lastRunAt: '2026-09-15T01:00:00.000Z', averageResponseMs: 800 },
      handovers: { waiting: 0, inProgress: 0, completed: 0 },
      triggerBreakdown: [{ trigger: '予約', count: 1, share: 1 }],
      items,
      pagination: { total: items.length, limit: 20, offset: 0 },
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
    root.render(<AutoReplyRunsPage />)
  })
  await flush()
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

beforeEach(() => {
  runsMock.mockResolvedValue(listResponse())
  retryRunMock.mockResolvedValue({ success: true, data: { status: 'completed' } })
})

function retryButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
    .filter((button) => /もう一度実行|実行しています/.test(button.textContent ?? ''))
}

describe('自動応答・実行結果の再実行（N-081）', () => {
  it('canRetry=true の行にだけ再実行ボタンが出る', async () => {
    runsMock.mockResolvedValue(listResponse([
      runItem({ id: 'evaluation-1', canRetry: true }),
      runItem({ id: 'evaluation-2', canRetry: false }),
    ]))
    await renderPage()
    expect(retryButtons()).toHaveLength(1)
  })

  it('押すと再実行の口を呼び、成功したら一覧を読み直す', async () => {
    await renderPage()
    expect(runsMock).toHaveBeenCalledTimes(1)
    expect(retryButtons()).toHaveLength(1)

    await act(async () => {
      retryButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(retryRunMock).toHaveBeenCalledWith('evaluation-1')
    expect(runsMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('失敗した処理をもう一度実行しました')
  })

  it('409 は「処理中または完了済み」の案内に読み替えて一覧を読み直す', async () => {
    retryRunMock.mockRejectedValue(new MockApiError(409, '処理中または完了済みのため、もう一度実行できません'))
    await renderPage()

    await act(async () => {
      retryButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(container.textContent).toContain('すでに処理中または完了しています')
    expect(runsMock).toHaveBeenCalledTimes(2)
  })

  it('実行中はボタンが効かず、二度押しで二重に飛ばない', async () => {
    let release: (value: unknown) => void = () => {}
    retryRunMock.mockReturnValue(new Promise((resolve) => { release = resolve }))
    await renderPage()

    const button = retryButtons()[0]
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(retryRunMock).toHaveBeenCalledTimes(1)
    expect(retryButtons()[0].disabled).toBe(true)

    await act(async () => {
      retryButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(retryRunMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      release({ success: true, data: { status: 'completed' } })
    })
    await flush()
    expect(runsMock).toHaveBeenCalledTimes(2)
  })

  it('それ以外の失敗は既存のメッセージ領域に出す', async () => {
    retryRunMock.mockRejectedValue(new MockApiError(500))
    await renderPage()

    await act(async () => {
      retryButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain('もう一度実行できませんでした')
    // 失敗時は一覧を読み直さない。
    expect(runsMock).toHaveBeenCalledTimes(1)
  })
})
