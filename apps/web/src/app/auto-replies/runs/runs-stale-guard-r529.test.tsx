// @vitest-environment happy-dom
/*
 * R529: 対象IDが変わったら古いルールの表示と操作を残さない。
 * 同じ画面のまま A→B へ移り、B の取得が失敗したら A の集計・操作は出ない。
 * 逆順で応答が届いても、表示は最新のIDに一致する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runs: vi.fn(),
  staffMe: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    autoReplies: {
      runs: mocks.runs,
      retryRun: vi.fn(),
      update: vi.fn(),
    },
    // R530: この試験は変更できる担当者の筋書き。見るだけの出し分けは
    // runs-viewer-gating で見る。
    staff: { me: mocks.staffMe },
  },
  ApiError: class MockApiError extends Error {
    readonly status: number
    constructor(status: number, message?: string) {
      super(message ?? `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
    }
  },
}))

let currentQuery = 'id=rule-a'

vi.mock('next/navigation', () => ({
  usePathname: () => '/auto-replies/runs',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(currentQuery),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: vi.fn(),
}))

import AutoReplyRunsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function listResponse(ruleId: string, ruleName: string, monthHits: number, priority: number) {
  return {
    success: true,
    data: {
      rule: { id: ruleId, name: ruleName, isActive: true, priorityPosition: priority },
      summary: { monthHits, totalHits: 5, handovers: 0, errors: 0, lastRunAt: '2026-09-15T01:00:00.000Z', averageResponseMs: 800 },
      handovers: { waiting: 0, inProgress: 0, completed: 0 },
      triggerBreakdown: [{ trigger: '予約', count: 2, share: 1 }],
      items: [],
      pagination: { total: 0, limit: 20, offset: 0 },
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

async function rerenderPage() {
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
  currentQuery = 'id=rule-a'
  mocks.staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
})

function pauseButton(): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').includes('一時停止'),
  ) ?? null
}

/* 設定編集の行き先。古いルールのIDが残ると、違うルールを編集してしまう。 */
function editHref(): string | null {
  const link = Array.from(container.querySelectorAll('a')).find((anchor) =>
    (anchor.textContent ?? '').includes('自動応答の設定を編集'),
  ) ?? null
  return link?.getAttribute('href')
}

describe('R529 対象ID切替で古いルールを残さない', () => {
  it('Bの取得失敗後はAの集計・操作が出ない', async () => {
    mocks.runs.mockImplementation(async ({ ruleId }: { ruleId?: string }) => {
      if (ruleId === 'rule-b') throw new Error('network down')
      return listResponse('rule-a', 'ルールA', 2, 1)
    })
    await renderPage()
    expect(editHref()).toContain('rule-a')
    expect(container.textContent).toContain('1番目')

    currentQuery = 'id=rule-b'
    await rerenderPage()

    expect(container.textContent).toContain('実行結果を読み込めませんでした')
    // Aの集計（優先順位1番目）は消え、編集の行き先もAを指さない。
    expect(container.textContent).not.toContain('1番目')
    expect(editHref()).not.toContain('rule-a')
    // 古いルールへの操作（停止）は押せない。
    expect(pauseButton()?.disabled).toBe(true)
  })

  it('逆順の応答でも表示は最新のIDに一致する', async () => {
    let resolveA!: (value: unknown) => void
    mocks.runs.mockImplementation(({ ruleId }: { ruleId?: string }) => {
      if (ruleId === 'rule-a') return new Promise((resolve) => { resolveA = resolve })
      return Promise.resolve(listResponse('rule-b', 'ルールB', 9, 3))
    })
    await renderPage()
    // Aはまだ返っていないので集計は出ていない。
    expect(container.textContent).not.toContain('1番目')

    currentQuery = 'id=rule-b'
    await rerenderPage()
    expect(editHref()).toContain('rule-b')
    expect(container.textContent).toContain('3番目')

    // 遅れて届いたAの応答は捨てられ、Bの表示へ戻らない。
    await act(async () => {
      resolveA(listResponse('rule-a', 'ルールA', 2, 1))
    })
    await flush()
    expect(editHref()).toContain('rule-b')
    expect(container.textContent).toContain('3番目')
    expect(container.textContent).not.toContain('1番目')
  })
})
