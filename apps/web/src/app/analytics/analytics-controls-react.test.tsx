// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

/**
 * 分析の対象者種別・期間選択を、本物のReactと本物のapi.ts経由で確かめる。
 *
 * 文字列契約だけでは、期間ボタンを押しても古いfrom/toのまま、またはファネルの
 * プルダウンだけ変わってPOST本文が固定、という退行を見逃す。そのため通信だけを
 * 差し替え、画面が実際に組み立てたURLとPOST本文を読む。
 */

const fixture = vi.hoisted(() => ({
  accountId: 'account-a',
  tab: 'friends',
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; init?: RequestInit }>,
  handler: ((path: string, init?: RequestInit) => new Promise<unknown>(() => {})) as
    (path: string, init?: RequestInit) => Promise<unknown>,
}))

vi.mock('next/link', () => ({ default: ({ children }: { children?: unknown }) => children }))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => fixture.tab,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push({ path, init })
    const body = await net.handler(path, init)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function funnelRun(label = '申込') {
  return {
    runId: 'run-1', funnelId: 'funnel-1', versionId: 'version-1', versionNumber: 1,
    lineAccountId: fixture.accountId, cohortFrom: '2026-08-10T00:00:00.000Z', cohortTo: '2026-09-09T00:00:00.000Z',
    timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-09-09T00:00:00.000Z', state: 'available', stateReason: null,
    groups: [{
      key: 'all', label: '全体', entrants: 10, completed: 2,
      steps: [
        { stepOrder: 1, label: '案内', reached: 10, conversionFromPrevious: 1, droppedAfter: 2, inProgressAfter: 1, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null },
        { stepOrder: 2, label, reached: 5, conversionFromPrevious: 0.5, droppedAfter: 2, inProgressAfter: 1, averageSecondsFromPrevious: 60, medianSecondsFromPrevious: 60 },
      ],
    }],
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T00:00:00.000Z'))
  fixture.accountId = 'account-a'
  fixture.tab = 'friends'
  net.calls.length = 0
  net.handler = () => new Promise<unknown>(() => {})
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<AnalyticsPage />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function click(label: string) {
  const target = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === label)
  if (!target) throw new Error(`「${label}」のボタンが見つかりません: ${host.textContent}`)
  await act(async () => { target.click(); await Promise.resolve() })
}

async function select(id: string, value: string) {
  const target = host.querySelector(`#${id}`) as HTMLSelectElement | null
  if (!target) throw new Error(`select #${id} が見つかりません`)
  await act(async () => {
    target.value = value
    target.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

function latestPath(prefix: string) {
  const path = net.calls.filter((call) => call.path.startsWith(prefix)).at(-1)?.path
  if (!path) throw new Error(`${prefix} の通信がありません`)
  return new URL(path, 'https://example.invalid').searchParams
}

function expectedRange(days: number) {
  const to = '2026-09-09'
  const from = new Date(Date.UTC(2026, 8, 9 - (days - 1))).toISOString().slice(0, 10)
  return { from, to }
}

describe('分析の対象者種別・期間選択(#835)', () => {
  it.each([
    ['friends', '/api/analytics/friends'],
    ['reactions', '/api/analytics/reactions'],
    ['routes', '/api/analytics/routes'],
    ['usage', '/api/analytics/usage'],
    ['url-clicks', '/api/analytics/url-clicks'],
  ])('%s は7/30/90日を実APIのfrom/toへ渡す', async (tab, endpoint) => {
    fixture.tab = tab
    await render()

    for (const days of [7, 30, 90]) {
      await click(`${days}日`)
      const params = latestPath(endpoint)
      expect(params.get('from')).toBe(expectedRange(days).from)
      expect(params.get('to')).toBe(expectedRange(days).to)
      expect(params.get('accountId') ?? params.get('account_id')).toBe('account-a')
    }
  })

  it('ファネルは3種別を実POSTし、7/30/90日のcohort期間で再集計する', async () => {
    fixture.tab = 'funnel'
    net.handler = async (path) => {
      if (path.startsWith('/api/staff/me')) return { success: true, data: { role: 'admin' } }
      if (path.startsWith('/api/analytics/funnels?')) {
        return { success: true, data: [{ id: 'funnel-1', name: '申込導線', windowDays: 14, createdAt: '2026-01-01T00:00:00.000Z', currentVersion: { id: 'version-1', versionNumber: 1, createdAt: '2026-01-01T00:00:00.000Z' }, migrationState: 'ready' }] }
      }
      if (path.includes('/runs/latest?')) return { success: true, data: funnelRun() }
      if (path.includes('/run?')) return { success: true, data: funnelRun() }
      if (path.startsWith('/api/analytics/results/run-1/audiences?')) return { success: true, data: { id: 'audience-1', memberCount: 5, expiresAt: '2026-09-10T00:00:00.000Z' } }
      throw new Error(`未設定: ${path}`)
    }
    await render()
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    const stage = host.querySelector('button[aria-label="申込の段"]') as HTMLButtonElement | null
    expect(stage).not.toBeNull()
    await act(async () => { stage?.click(); await Promise.resolve() })

    for (const selection of ['reached', 'stopped', 'in_progress'] as const) {
      await select('funnel-audience-selection', selection)
      await click('友だち一覧で見る')
      const request = net.calls.filter((call) => call.path.startsWith('/api/analytics/results/run-1/audiences?')).at(-1)
      expect(request, JSON.stringify(net.calls)).toBeDefined()
      expect(JSON.parse(String(request?.init?.body))).toMatchObject({
        sourceKind: 'funnel', groupKey: 'all', stepOrder: 1, selection,
      })
    }

    for (const days of [7, 30, 90]) {
      await click(`${days}日`)
      await click(`この${days}日を再集計`)
      const request = net.calls.filter((call) => call.path.includes('/api/analytics/funnels/funnel-1/run?')).at(-1)
      expect(JSON.parse(String(request?.init?.body))).toEqual({
        cohortFrom: `${expectedRange(days).from}T00:00:00.000Z`,
        cohortTo: '2026-09-09T00:00:00.000Z',
      })
    }
  })

  it('アカウント切替後、遅れて返った古いファネル再集計を表示しない', async () => {
    fixture.tab = 'funnel'
    const late = deferred<unknown>()
    net.handler = async (path) => {
      if (path.startsWith('/api/staff/me')) return { success: true, data: { role: 'admin' } }
      if (path.startsWith('/api/analytics/funnels?')) {
        return { success: true, data: [{ id: 'funnel-1', name: '申込導線', windowDays: 14, createdAt: '2026-01-01T00:00:00.000Z', currentVersion: { id: 'version-1', versionNumber: 1, createdAt: '2026-01-01T00:00:00.000Z' }, migrationState: 'ready' }] }
      }
      if (path.includes('/runs/latest?')) return { success: false, error: 'Not found' }
      if (path.includes('/run?')) return late.promise
      throw new Error(`未設定: ${path}`)
    }
    await render()
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    await click('この30日を再集計')

    fixture.accountId = 'account-b'
    await render()
    late.resolve({ success: true, data: funnelRun('古い申込') })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).not.toContain('古い申込')
  })
})
