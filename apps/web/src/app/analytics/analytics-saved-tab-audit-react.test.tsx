// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

/**
 * 保存タブの監査 R454・R456・R462・R463。
 *
 * R456: アカウント切替後に遅い旧応答で一覧・確認窓が戻らない。
 * R462: 履歴の失敗は一覧KPIを隠さず、回復したら案内が消える。
 * R463: 履歴1件ごとに固定結果を開け、CSVも分けられる。
 * R454: しまった1回送信の直近結果から依頼IDの画面へ進める。
 */

const fixture = vi.hoisted(() => ({
  accountId: 'account-a' as string,
  role: 'owner' as 'owner' | 'staff',
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
  handler: ((url: string) =>
    Promise.reject(new Error(`未設定: ${url}`))) as
      (url: string, init?: RequestInit) => Promise<unknown>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => 'saved',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { return this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const body = await net.handler(path, init)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

const SAVED_ITEM = {
  id: 'saved-1', name: '流入別の成果', kind: 'cross', status: 'active',
  currentVersionNumber: 1, createdBy: 'u-1', createdByName: 'テスト',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  snapshotCount: 2,
  latestSnapshot: {
    id: 'snap-2', state: 'available', periodFrom: '2026-09-21', periodTo: '2026-09-27',
    dataCutoffAt: '2026-09-28T00:00:00.000Z', createdAt: '2026-09-28T00:00:00.000Z',
  },
}

const SNAPSHOTS = [
  {
    id: 'snap-2', savedAnalysisId: 'saved-1', analysisVersionId: 'v1', sourceKind: 'cross',
    sourceResultId: 'cross-1', periodFrom: '2026-09-21', periodTo: '2026-09-27',
    timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-09-28T00:00:00.000Z', state: 'available',
    result: { totalFriends: 129001, missing: null }, createdBy: null, createdAt: '2026-09-28T00:00:00.000Z',
  },
]

function scheduleOf(account: string, name: string) {
  return {
    id: `report-${account}`, lineAccountId: account, name,
    sections: ['friends'], savedAnalysisIds: [], cadence: 'weekly', weekday: 1,
    monthDay: null, sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
    recipients: [], channels: ['dashboard'], alertRules: [], status: 'active',
    isOneTime: false, nextRunAt: '2026-09-28T00:00:00.000Z', createdBy: 'u-1',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

const OPTIONS = {
  timeZone: 'Asia/Tokyo', savedAnalyses: [], recipients: [],
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.role = 'owner'
  net.calls.length = 0
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
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
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => { root.render(<AnalyticsPage />) })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  )
  if (!found) throw new Error(`ボタンが見つからない: ${label}`)
  return found
}

function listHandler(state: {
  snapshotsMode: 'ok' | 'fail-once-then-ok'
  snapshotsFailedOnce: boolean
  recentOneTime: unknown[]
}) {
  return (path: string, init?: RequestInit) => {
    if (path === '/api/staff/me') return Promise.resolve({ success: true, data: { role: fixture.role } })
    if (path.includes('/api/analytics/saved/') && path.includes('/snapshots')) {
      if (state.snapshotsMode === 'fail-once-then-ok' && !state.snapshotsFailedOnce) {
        state.snapshotsFailedOnce = true
        return Promise.resolve({ success: false, error: 'boom' })
      }
      return Promise.resolve({ success: true, data: SNAPSHOTS })
    }
    if (path.startsWith('/api/analytics/saved')) return Promise.resolve({ success: true, data: [SAVED_ITEM] })
    if (path.startsWith('/api/analytics/report-schedules')) {
      const account = path.includes('account_id=account-b') ? 'account-b' : 'account-a'
      const name = account === 'account-b' ? 'Bのレポート' : 'Aのレポート'
      return Promise.resolve({
        success: true,
        data: { items: [scheduleOf(account, name)], recentOneTime: state.recentOneTime, options: OPTIONS },
      })
    }
    return Promise.reject(new Error(`未設定: ${path}`))
  }
}

describe('R462 履歴の失敗は一覧を隠さず回復したら消える', () => {
  it('一覧成功・履歴失敗でもKPIは件数を保ち、再試行成功で案内が消える', async () => {
    const state = { snapshotsMode: 'fail-once-then-ok' as const, snapshotsFailedOnce: false, recentOneTime: [] }
    net.handler = listHandler(state)
    await render()
    // 履歴の失敗案内は出るが、一覧KPIは取得済みの件数のまま
    expect(host.textContent).toContain('結果の履歴を読み込めませんでした')
    expect(host.textContent).toContain('保存した分析')
    // 「—・読み込めませんでした」のままにならない（件数が出る）
    expect(host.textContent).not.toMatch(/保存した結果\s*—/)

    // もう一度で履歴200が返ると古い案内が消える
    await act(async () => { button('もう一度').click() })
    expect(host.textContent).not.toContain('結果の履歴を読み込めませんでした')
  })
})

describe('R463 履歴から固定結果を開ける', () => {
  it('合成値129001を含む結果の数値と期間を確認できる', async () => {
    const state = { snapshotsMode: 'ok' as const, snapshotsFailedOnce: true, recentOneTime: [] }
    net.handler = listHandler(state)
    await render()
    expect(host.textContent).toContain('この時点の結果を見る')
    // 開くと固定結果の数値が出る
    const details = host.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    const summary = host.querySelector('details summary') as HTMLElement
    await act(async () => { summary.click() })
    expect(details.open).toBe(true)
    expect(host.textContent).toContain('129,001')
    expect(host.textContent).toContain('2026/9/21〜2026/9/27')
    // 未取得の区別も出る
    expect(host.textContent).toContain('未取得')
    // 保存結果のCSVは一覧のCSVと別の入口
    expect(host.textContent).toContain('この分析の結果をCSVで書き出す')
  })
})

describe('R456 アカウント切替後に旧応答で置き換えない', () => {
  it('再読込中にBへ移ると遅いA応答を捨て、しまう確認も閉じる', async () => {
    const state = { snapshotsMode: 'ok' as const, snapshotsFailedOnce: true, recentOneTime: [] }
    const base = listHandler(state)
    let releaseA: ((value: unknown) => void) | null = null
    net.handler = (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/analytics/report-schedules/') && init?.method === 'PUT') {
        // 状態変更を失敗させて再読込（reloadSchedules）を起こす
        return Promise.resolve({ success: false, error: '同時更新' })
      }
      if (path.startsWith('/api/analytics/report-schedules?') && !path.includes('account_id=account-b')
        && net.calls.filter((c) => c.path === path).length > 1) {
        // Aの再読込（2回目）だけ遅らせる
        return new Promise((resolve) => { releaseA = resolve })
      }
      return base(path, init)
    }
    await render()
    expect(host.textContent).toContain('Aのレポート')

    // しまう確認を開いておく（確認窓はポータルのため document 全体で見る）
    await act(async () => { button('しまう').click() })
    expect(document.body.textContent).toContain('定期レポートをしまいますか')

    // 止める→失敗→再読込が始まる（応答はまだ返さない）
    await act(async () => { button('止める').click() })
    expect(releaseA).not.toBeNull()

    // しまう確認を開いたままBへ切り替える
    fixture.accountId = 'account-b'
    await render()
    expect(host.textContent).toContain('Bのレポート')
    // Aの確認窓は閉じる
    expect(document.body.textContent).not.toContain('定期レポートをしまいますか')

    // 遅いAの再読込応答が返ってもBのまま
    await act(async () => {
      releaseA?.({
        success: true,
        data: { items: [scheduleOf('account-a', 'Aのレポート')], recentOneTime: [], options: OPTIONS },
      })
    })
    expect(host.textContent).toContain('Bのレポート')
    expect(host.textContent).not.toContain('Aのレポート')
  })
})

describe('R454 しまった1回送信の直近結果から進める', () => {
  it('一覧とは別に結果へのリンクが出る', async () => {
    const state = {
      snapshotsMode: 'ok' as const, snapshotsFailedOnce: true,
      recentOneTime: [{
        schedule: { ...scheduleOf('account-a', '1回送信'), id: 'once-1', isOneTime: true, status: 'archived' },
        lastRun: {
          id: 'run-1', scheduleId: 'once-1', state: 'failed', errorCode: 'synthetic_mail_failed',
          deliveryResults: [{ channel: 'email', recipient: 'a@example.com', status: 'failed', reason: 'x' }],
        },
      }],
    }
    net.handler = listHandler(state)
    await render()
    expect(host.textContent).toContain('1回だけ送った結果')
    expect(host.textContent).toContain('失敗')
    const link = host.querySelector('a[href="/analytics/reports/new?id=once-1"]')
    expect(link).toBeTruthy()
    expect(link?.textContent).toContain('結果を見る')
  })
})
