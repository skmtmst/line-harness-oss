// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R492・R493・R494・R495 の回帰テスト。
 * 本物のReactで実行履歴ページをmountし、店切替・詳細失敗・再試行・CSVの
 * 振る舞いを見張る。
 *
 * - R492: 店を替えたら前の店の詳細・取消確認を残さない。始めた店と違う
 *         店には取消の結果を書かない。
 * - R493: 詳細の取得失敗は「記録なし」と別表示。403は権限不足（再読込なし）。
 * - R494: 再試行の応答消失・競合では状態を取り直し、受付済みを明示する。
 * - R495: CSVが上限で切れたら件数と分け方を知らせる。
 */

const account = vi.hoisted(() => ({ id: 'account-1' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/automations/runs',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: account.id, loading: false }) }))
vi.mock('@/components/automations/use-can-manage', () => ({
  useAutomationRunPermissions: () => ({ canOperate: true, canExport: true }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/components/layout/merged-tabs', () => ({ default: () => null }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    fetchApi: vi.fn(),
    downloadApiFile: vi.fn(),
    api: {
      ...actual.api,
      automations: {
        ...actual.api.automations,
        getRun: vi.fn(),
        cancelRun: vi.fn(),
      },
    },
  }
})

import { api, ApiError, downloadApiFile, fetchApi } from '@/lib/api'
import AutomationRunsPage from './page'

const mockFetch = fetchApi as unknown as ReturnType<typeof vi.fn>
const mockDownload = downloadApiFile as unknown as ReturnType<typeof vi.fn>
const mockGetRun = api.automations.getRun as unknown as ReturnType<typeof vi.fn>
const mockCancelRun = api.automations.cancelRun as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function ok<T>(data: T) {
  return { success: true, data }
}

const rowA = {
  id: 'run-a', occurredAt: '2026-09-20T01:00:00.000Z', subject: '田中さん',
  accountLabel: 'A店', triggerLabel: '友だち追加', status: 'waiting',
  detail: '待っています', durationMs: null, automationName: '予約案内',
  canRetry: false, versionNumber: 1, isTest: false, canCancel: true,
}

const rowB = {
  id: 'run-b', occurredAt: '2026-09-20T02:00:00.000Z', subject: '佐藤さん',
  accountLabel: 'B店', triggerLabel: '友だち追加', status: 'succeeded',
  detail: '終わりました', durationMs: 100, automationName: '予約案内',
  canRetry: false, versionNumber: 1, isTest: false, canCancel: false,
}

function listResponse(items: Array<Record<string, unknown>>, total: number) {
  return ok({
    summary: { total, executed: total, skipped: 0, failed: 0, mostRunName: '予約案内', mostRunCount: total },
    items,
    pagination: { total, limit: 20, offset: 0 },
  })
}

const detailA = {
  id: 'run-a', automationId: 'auto-1', automationName: '予約案内',
  automationVersionId: 'ver-1', versionNumber: 1, isTest: false,
  canCancel: true, canRetry: false, occurredAt: '2026-09-20T01:00:00.000Z',
  subject: '田中さん', accountLabel: 'A店', triggerLabel: '友だち追加',
  status: 'waiting', domainStatus: 'waiting', detail: '待っています',
  durationMs: null, failureReason: null, holdReason: null,
  isCurrentVersion: true, currentVersionNumber: 1,
  successfulActions: [], skippedActions: [], failedAction: null,
  friendId: 'friend-1', friendName: '田中さん', steps: [],
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  account.id = 'account-1'
  mockFetch.mockReset()
  mockDownload.mockReset()
  mockGetRun.mockReset()
  mockCancelRun.mockReset()
  mockFetch.mockImplementation(async (path: string) => {
    if (String(path).includes('lineAccountId=account-2')) return listResponse([rowB], 1)
    return listResponse([rowA], 1)
  })
  mockGetRun.mockResolvedValue(ok(detailA))
  mockCancelRun.mockResolvedValue(ok({ runId: 'run-a', status: 'cancelled', alreadyCancelled: false, cancelledStepCount: 1 }))
  mockDownload.mockResolvedValue({ totalCount: 1, returnedCount: 1, truncated: false })
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  if (container) container.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

async function mountPage(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<AutomationRunsPage />) })
  // 一覧の読み込みは400ms遅延する。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
  await act(async () => { await drainMicrotasks() })
  if (!container.textContent?.includes('動いた記録')) throw new Error('実行履歴が出ませんでした')
  return container
}

async function openDetail(el: HTMLDivElement): Promise<void> {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === '中身を見る')
  if (!button) throw new Error('「中身を見る」ボタンが見つかりません')
  await act(async () => { (button as HTMLButtonElement).click() })
  await act(async () => { await drainMicrotasks() })
  if (!el.textContent?.includes('実行記録の中身')) throw new Error('詳細が出ませんでした')
}

describe('R492: 店を替えたら前の店の詳細・確認を残さない', () => {
  it('A店の詳細を開いてB店へ替えると、詳細と取消確認が消える', async () => {
    const el = await mountPage()
    await openDetail(el)
    // 取消の確認まで開く。
    const cancel = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === 'この実行を取りやめる')
    await act(async () => { (cancel as HTMLButtonElement).click() })
    expect(el.textContent).toContain('取りやめますか')
    // B店へ。A店の詳細・確認は残らない。
    account.id = 'account-2'
    await act(async () => { root!.render(<AutomationRunsPage />) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
    await act(async () => { await drainMicrotasks() })
    expect(el.textContent).not.toContain('実行記録の中身')
    expect(el.textContent).not.toContain('取りやめますか')
    expect(el.textContent).toContain('佐藤さん')
  })

  it('取消の応答が店切替後に返っても、替えた先へ書かない', async () => {
    const el = await mountPage()
    await openDetail(el)
    let releaseCancel!: (value: unknown) => void
    mockCancelRun.mockReturnValueOnce(new Promise((resolve) => { releaseCancel = resolve as (value: unknown) => void }))
    const cancel = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === 'この実行を取りやめる')
    await act(async () => { (cancel as HTMLButtonElement).click() })
    const confirm = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === '取りやめる')
    await act(async () => { (confirm as HTMLButtonElement).click() })
    // 応答待ちの間にB店へ。
    account.id = 'account-2'
    await act(async () => { root!.render(<AutomationRunsPage />) })
    await act(async () => { releaseCancel(ok({ runId: 'run-a', status: 'cancelled', alreadyCancelled: false, cancelledStepCount: 1 })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
    await act(async () => { await drainMicrotasks() })
    // B店の画面にA店の取消結果は書かない。
    expect(el.textContent).not.toContain('実行を取りやめました')
    expect(el.textContent).not.toContain('実行記録の中身')
  })
})

describe('R493: 詳細の失敗は「記録なし」と別に、権限不足も区別する', () => {
  it('通信の失敗は理由と「もう一度読む」を出す', async () => {
    mockGetRun.mockRejectedValueOnce(new ApiError(503, '読み込めませんでした'))
    const el = await mountPage()
    await openDetail(el)
    expect(el.textContent).toContain('詳細を読み込めませんでした')
    expect(el.textContent).toContain('もう一度読む')
    expect(el.textContent).not.toContain('処理の記録はありません')
    await act(async () => {
      (Array.from(el.querySelectorAll('button')).find((node) => node.textContent === 'もう一度読む') as HTMLButtonElement).click()
    })
    await act(async () => { await drainMicrotasks() })
    expect(mockGetRun).toHaveBeenCalledTimes(2)
  })

  it('権限不足は「見る権限がありません」と出し、再読込は出さない', async () => {
    mockGetRun.mockRejectedValueOnce(new ApiError(403, '権限がありません'))
    const el = await mountPage()
    await openDetail(el)
    expect(el.textContent).toContain('この実行を見る権限がありません')
    expect(el.textContent).not.toContain('もう一度読む')
    expect(el.textContent).not.toContain('処理の記録はありません')
  })

  it('0件のときだけ「処理の記録はありません」と出す', async () => {
    const el = await mountPage()
    await openDetail(el)
    expect(el.textContent).toContain('処理の記録はありません')
  })
})

describe('R494・R495: 再試行の応答消失とCSVの上限', () => {
  it('R494: 再試行の応答が失われたら状態を取り直し、受付済みを明示する', async () => {
    const failedRow = { ...rowA, id: 'run-f', status: 'permanent_failed', detail: '失敗しました', canRetry: true, canCancel: false }
    // 再試行POSTは応答消失（通信切れ）。DBでは waiting へ変わっているので、
    // 取り直しの一覧は waiting を返す。初回の一覧は失敗のまま。
    let listCalls = 0
    mockFetch.mockImplementation(async (path: string) => {
      if (String(path).includes('/retry')) throw new Error('network down')
      listCalls += 1
      return listCalls <= 1
        ? listResponse([failedRow], 1)
        : listResponse([{ ...failedRow, status: 'waiting', canRetry: false }], 1)
    })
    mockGetRun.mockResolvedValue(ok({ ...detailA, id: 'run-f', status: 'waiting', canRetry: false, canCancel: true }))
    const el = await mountPage()
    await openDetail(el)
    const retry = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === 'もう一度やる')
    await act(async () => { (retry as HTMLButtonElement).click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
    await act(async () => { await drainMicrotasks() })
    // 古い失敗のままにせず、受付済みを出す。古い再試行ボタンは残さない。
    expect(el.textContent).toContain('再試行を受け付けています')
    expect(el.querySelectorAll('button')).toSatisfy(
      (buttons) => !Array.from(buttons as unknown as HTMLButtonElement[]).some((node) => node.textContent === 'もう一度やる'),
    )
  })

  it('R495: CSVが上限で切れたら件数と分け方を知らせる', async () => {
    mockFetch.mockResolvedValue(listResponse([rowA], 5001))
    mockDownload.mockResolvedValue({ totalCount: 5001, returnedCount: 5000, truncated: true })
    const el = await mountPage()
    // 書き出す前から上限の案内が出る。
    expect(el.textContent).toContain('5,000件までしか出ません')
    const csv = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === 'CSVで書き出す')
    await act(async () => { (csv as HTMLButtonElement).click() })
    await act(async () => { await drainMicrotasks() })
    expect(el.textContent).toContain('残り1件')
    expect(el.textContent).toContain('分けて出してください')
  })
})
