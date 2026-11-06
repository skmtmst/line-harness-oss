// @vitest-environment happy-dom
/*
 * 自動応答・実行結果（t7UtYQ）の状態の描き分け。
 * 未取得は「—」で、実際の 0 とは混ぜない。読込・失敗・空は共通の状態表示で別々に出し、
 * 口が知らない状態を返しても画面を落とさず「確認中」の札にする。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runs: vi.fn(), staffMe: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: { autoReplies: { runs: mocks.runs, retryRun: vi.fn(), update: vi.fn() }, staff: { me: mocks.staffMe } },
  ApiError: class extends Error {
    readonly status: number
    constructor(status: number, message?: string) { super(message ?? `API error: ${status}`); this.status = status }
  },
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/auto-replies/runs',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))

import AutoReplyRunsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function response(summary: Record<string, unknown>, items: Array<Record<string, unknown>>) {
  return {
    success: true,
    data: {
      rule: { id: 'rule-1', name: '予約問い合わせ', isActive: true, priorityPosition: 1 },
      summary: { monthHits: 0, totalHits: 0, handovers: 0, errors: 0, lastRunAt: null, averageResponseMs: null, ...summary },
      handovers: { waiting: 0, inProgress: 0, completed: 0 },
      triggerBreakdown: [],
      items,
      pagination: { total: items.length, limit: 20, offset: 0 },
    },
  }
}

function run(status: string) {
  return {
    id: 'evaluation-1', status, detail: '処理しました', durationMs: 800, canRetry: false,
    friendName: '田中さん', inputPreview: '予約したい', triggerLabel: '予約', accountLabel: '本店',
    replyStatus: 'accepted', actionSummary: { executed: 1, failed: 0 }, occurredAt: '2026-09-15T01:00:00.000Z',
  }
}

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => { for (let step = 0; step < 10; step += 1) await Promise.resolve() })
}

async function renderPage() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<AutoReplyRunsPage />) })
  await flush()
}

function kpi(title: string): string {
  const card = [...container.querySelectorAll('[data-kpi-presentation]')]
    .find((element) => element.querySelector('[data-kpi-label]')?.textContent?.includes(title))
  if (!card) throw new Error(`kpi not found: ${title}`)
  return card.textContent ?? ''
}

beforeEach(() => { mocks.staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } }) })
afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.clearAllMocks()
})

it('読めなかったときは集計を「—」にし、失敗の帯から読み直せる', async () => {
  mocks.runs.mockRejectedValueOnce(new Error('network down'))
  await renderPage()
  for (const title of ['今月当たった', '失敗した処理', '平均で返すまで']) {
    expect(kpi(title)).toContain('—')
    expect(kpi(title)).not.toMatch(/(^|\D)0(回|件|秒)/)
  }
  const failure = container.querySelector('[data-list-state="error"]')
  expect(failure?.textContent).toContain('実行結果を読み込めませんでした')
  expect(container.textContent).not.toContain('実行結果はまだありません')
  mocks.runs.mockResolvedValue(response({ monthHits: 3 }, [run('succeeded')]))
  const retry = [...failure!.querySelectorAll('button')].find((button) => button.textContent?.includes('もう一度'))!
  await act(async () => { retry.click() })
  await flush()
  expect(container.querySelector('[data-list-state="error"]')).toBeNull()
  expect(kpi('今月当たった')).toContain('3')
})

it('読めた 0 は 0 と出し、平均が未集計なら「—」にする', async () => {
  mocks.runs.mockResolvedValue(response({ monthHits: 0, errors: 0, averageResponseMs: null }, [run('succeeded')]))
  await renderPage()
  expect(kpi('今月当たった')).toMatch(/0\s*回/)
  expect(kpi('失敗した処理')).toMatch(/0\s*件/)
  expect(kpi('平均で返すまで')).toContain('—')
})

it('平均は秒に直して出す', async () => {
  mocks.runs.mockResolvedValue(response({ averageResponseMs: 1500 }, [run('succeeded')]))
  await renderPage()
  expect(kpi('平均で返すまで')).toMatch(/1\.5\s*秒/)
})

it('読み込み中は読込の表示だけを出し、空や失敗と言わない', async () => {
  mocks.runs.mockReturnValue(new Promise(() => {}))
  await renderPage()
  // 本体の一覧と、きっかけの内訳の欄の両方が読込の表示になる（空・失敗の表示は1つも出さない）。
  expect(container.querySelectorAll('[data-list-state="loading"]')).toHaveLength(2)
  expect(container.querySelector('[data-list-state="error"]')).toBeNull()
  expect(container.querySelector('[data-list-state="empty"]')).toBeNull()
  expect(container.textContent).not.toContain('実行結果はまだありません')
})

it('0件は空の表示で、失敗とは分ける', async () => {
  mocks.runs.mockResolvedValue(response({}, []))
  await renderPage()
  const empty = container.querySelector('[data-list-state="empty"]')
  expect(empty?.textContent).toContain('実行結果はまだありません')
  expect(container.querySelector('[data-list-state="error"]')).toBeNull()
})

it('知らない状態の記録が来ても画面を落とさず「確認中」の札にする', async () => {
  mocks.runs.mockResolvedValue(response({}, [run('future_status')]))
  await renderPage()
  const table = container.querySelector('[aria-label="実行の記録"]')
  expect(table?.textContent).toContain('田中さん')
  expect(table?.textContent).toContain('確認中')
})
