// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

/**
 * 分析の「数えるもの」選択・エラーの読み直し・読み上げ対応を、本物のReactと
 * 本物のapi.ts経由で確かめる(#951 / N-276・N-287・N-288)。
 *
 * 文字列契約だけでは「measureがunique_friendsに固定」「エラー表示に再試行が
 * 無い」「期間ボタンに押下状態が無い」がすり抜ける。通信だけを差し替え、
 * 画面が実際に組み立てたPOST本文・再要求の本数・aria属性を読む。
 */

const fixture = vi.hoisted(() => ({
  accountId: 'account-a',
  tab: 'friends' as string,
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; init?: RequestInit }>,
  handler: ((path: string, init?: RequestInit) =>
    Promise.reject(new Error(`未設定: ${path}`))) as
      (path: string, init?: RequestInit) => Promise<unknown>,
}))

vi.mock('next/link', () => ({ default: ({ children }: { children?: unknown }) => children }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
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

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const metric = (value: number | null) => ({ value, state: 'available', reason: null })

function envelope(data: unknown) {
  return {
    success: true,
    data: {
      lineAccountId: fixture.accountId,
      timeZone: 'Asia/Tokyo',
      period: { from: '2026-08-11', to: '2026-09-09' },
      dataCutoffAt: '2026-09-09T00:00:00.000Z',
      data,
    },
  }
}

function friendsOverview() {
  return envelope({
    state: 'available',
    stateReason: null,
    metrics: {
      added: metric(8), removed: metric(3), net: metric(5),
      currentFriends: metric(120), firstTime: metric(6), returning: metric(2),
    },
    days: [
      { date: '2026-09-08', added: 3, removed: 1, net: 2 },
      { date: '2026-09-09', added: 5, removed: 2, net: 3 },
    ],
    campaigns: [],
    historyAvailableFrom: null,
  })
}

function reactionsOverview() {
  return envelope({
    metrics: {
      sent: metric(2), delivered: metric(100), opened: metric(40),
      lineClicked: metric(10), trackedClicks: metric(4), unavailableCampaigns: metric(0),
    },
    campaigns: [],
    campaignsTruncation: { limit: 200, broadcast: false, scenario: false },
    trackedClickHours: [{ hour: 9, clicks: 4 }],
    clickDefinition: '中継URLのクリック数',
  })
}

function routesOverview() {
  return envelope({
    attributionModel: 'first_touch',
    attributionLabel: '最初の接点',
    routes: [],
    searchConsoleHref: 'https://search.google.com/',
  })
}

const FUNNELS = [
  {
    id: 'funnel-1', name: '申込導線', windowDays: 14,
    createdAt: '2026-01-01T00:00:00.000Z', status: 'active',
    currentVersion: { id: 'version-1', versionNumber: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    migrationState: 'ready',
  },
]

function funnelRun() {
  return {
    runId: 'run-1', funnelId: 'funnel-1', versionId: 'version-1', versionNumber: 1,
    lineAccountId: fixture.accountId,
    cohortFrom: '2026-08-10T00:00:00.000Z', cohortTo: '2026-09-09T00:00:00.000Z',
    timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-09-09T00:00:00.000Z',
    state: 'available', stateReason: null,
    groups: [{
      key: 'all', label: '全体', entrants: 10, completed: 5,
      steps: [
        { stepOrder: 1, label: '案内', reached: 10, conversionFromPrevious: 1, droppedAfter: 2, inProgressAfter: 1, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null },
        { stepOrder: 2, label: '申込', reached: 5, conversionFromPrevious: 0.5, droppedAfter: 2, inProgressAfter: 1, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null },
      ],
    }],
  }
}

const FIELDS = [{ id: 'field-1', name: '好きな動物', fieldKey: 'pet', fieldType: 'select' }]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T00:00:00.000Z'))
  fixture.accountId = 'account-a'
  fixture.tab = 'friends'
  net.calls.length = 0
  net.handler = (path) => Promise.reject(new Error(`未設定: ${path}`))
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

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.includes(label),
  )
  if (!found) throw new Error(`「${label}」のボタンが見つかりません: ${host.textContent}`)
  return found as HTMLButtonElement
}

async function click(label: string) {
  const target = button(label)
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

const callsTo = (prefix: string) => net.calls.filter((call) => call.path.startsWith(prefix))
const lastBody = (prefix: string) => JSON.parse(String(callsTo(prefix).at(-1)?.init?.body))

/** 権限だけ共通で返し、残りは試験ごとの差し替えへ渡す。 */
function withStaff(rest: (path: string, init?: RequestInit) => Promise<unknown>) {
  return (path: string, init?: RequestInit): Promise<unknown> => {
    if (path.startsWith('/api/staff/me')) return Promise.resolve({ success: true, data: { role: 'admin' } })
    return rest(path, init)
  }
}

describe('クロス分析の「数えるもの」選択(N-276)', () => {
  it('既定は友だちの人数で、measureがunique_friendsのPOSTになる', async () => {
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/friend-fields')) return { success: true, data: FIELDS }
      if (path.startsWith('/api/analytics/cross/query')) return { success: true, data: { id: 'run-1', state: 'pending' } }
      if (path.startsWith('/api/analytics/cross/results/')) return {
        success: true,
        data: { id: 'run-1', state: 'pending', errorCode: null, result: null, createdAt: '2026-09-09T00:00:00.000Z', queuePosition: 1, pendingAhead: 0, estimatedWaitMs: null, nextTickAt: null },
      }
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'cross'
    await render()

    expect(host.querySelector('#cross-measure')).not.toBeNull()
    // イベント種類の選択は「イベントの回数」を選ぶまで出さない。
    expect(host.querySelector('#cross-measure-event')).toBeNull()

    await click('この30日を集計')
    expect(lastBody('/api/analytics/cross/query').measure).toEqual({ kind: 'unique_friends' })
  })

  it('イベントの回数を選ぶと種類も選べ、measureがeventsのPOSTになる', async () => {
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/friend-fields')) return { success: true, data: FIELDS }
      if (path.startsWith('/api/analytics/cross/query')) return { success: true, data: { id: 'run-1', state: 'pending' } }
      if (path.startsWith('/api/analytics/cross/results/')) return {
        success: true,
        data: { id: 'run-1', state: 'pending', errorCode: null, result: null, createdAt: '2026-09-09T00:00:00.000Z', queuePosition: 1, pendingAhead: 0, estimatedWaitMs: null, nextTickAt: null },
      }
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'cross'
    await render()

    await select('cross-measure', 'events')
    // 記録が「取得可能」な種類だけが選べる。未接続の種類は候補に出さない。
    const eventSelect = host.querySelector('#cross-measure-event') as HTMLSelectElement | null
    expect(eventSelect).not.toBeNull()
    const values = Array.from(eventSelect?.querySelectorAll('option') ?? []).map((option) => option.value)
    expect(values).toEqual(['message_received', 'postback_received', 'friend_add', 'friend_unfollow'])
    expect(values).not.toContain('url_clicked')

    await select('cross-measure-event', 'postback_received')
    await click('この30日を集計')
    expect(lastBody('/api/analytics/cross/query').measure).toEqual({ kind: 'events', eventType: 'postback_received' })
  })
})

describe('エラー面の読み直し(N-287)', () => {
  it('概要の取得失敗は「もう一度読み込む」で同じ条件を取り直す', async () => {
    let friendsOk = false
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/analytics/friends')) {
        if (!friendsOk) throw new Error('接続できませんでした')
        return friendsOverview()
      }
      if (path.startsWith('/api/analytics/routes')) return routesOverview()
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'friends'
    await render()

    expect(host.textContent).toContain('分析を表示できませんでした')
    expect(callsTo('/api/analytics/friends')).toHaveLength(1)

    friendsOk = true
    await click('もう一度読み込む')
    await act(async () => { await Promise.resolve() })

    expect(callsTo('/api/analytics/friends')).toHaveLength(2)
    expect(host.textContent).toContain('日ごとの増減')
  })

  it('クロス分析の友だち情報欄の取得失敗も、その場で読み直せる', async () => {
    let fieldsOk = false
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/friend-fields')) {
        if (!fieldsOk) throw new Error('接続できませんでした')
        return { success: true, data: FIELDS }
      }
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'cross'
    await render()

    expect(host.textContent).toContain('友だち情報欄を読み込めませんでした。')
    expect(callsTo('/api/friend-fields')).toHaveLength(1)

    fieldsOk = true
    await click('もう一度読み込む')
    await act(async () => { await Promise.resolve() })

    expect(callsTo('/api/friend-fields')).toHaveLength(2)
    expect(host.querySelector('#cross-field')).not.toBeNull()
    expect(host.textContent).toContain('この30日を集計')
  })

  it('ファネル一覧の取得失敗も、その場で読み直せる', async () => {
    let listOk = false
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/analytics/funnels?')) {
        if (!listOk) throw new Error('接続できませんでした')
        return { success: true, data: FUNNELS }
      }
      if (path.includes('/runs/latest?')) return { success: false, error: 'Not found' }
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'funnel'
    await render()

    expect(host.textContent).toContain('ファネルを読み込めませんでした。')
    expect(callsTo('/api/analytics/funnels?')).toHaveLength(1)

    listOk = true
    await click('もう一度読み込む')
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(callsTo('/api/analytics/funnels?')).toHaveLength(2)
    expect(host.textContent).toContain('申込導線')
  })

  it('保存した分析一覧の取得失敗も、その場で読み直せる', async () => {
    let listOk = false
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/analytics/saved?')) {
        if (!listOk) throw new Error('接続できませんでした')
        return { success: true, data: [] }
      }
      if (path.startsWith('/api/analytics/report-schedules')) return { success: true, data: { items: [], options: { timeZone: 'Asia/Tokyo', savedAnalyses: [], recipients: [] } } }
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'saved'
    await render()

    expect(host.textContent).toContain('接続できませんでした')
    expect(callsTo('/api/analytics/saved?')).toHaveLength(1)

    listOk = true
    await click('もう一度読み込む')
    await act(async () => { await Promise.resolve() })

    expect(callsTo('/api/analytics/saved?')).toHaveLength(2)
    expect(host.textContent).toContain('保存した分析はまだありません')
  })
})

describe('棒グラフと期間切替の読み上げ(N-288)', () => {
  it('期間ボタンはグループ化され、選んだ側にaria-pressedが立つ', async () => {
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/analytics/friends')) return friendsOverview()
      if (path.startsWith('/api/analytics/routes')) return routesOverview()
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'friends'
    await render()

    const group = host.querySelector('[role="group"][aria-label="集計期間"]')
    expect(group).not.toBeNull()
    const before = button('30日')
    expect(before.getAttribute('aria-pressed')).toBe('true')

    await click('90日')
    expect(button('90日').getAttribute('aria-pressed')).toBe('true')
    expect(button('30日').getAttribute('aria-pressed')).toBe('false')
  })

  it('日ごとの棒は日付と増減を読み上げられ、選んだ日が分かる', async () => {
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/analytics/friends')) return friendsOverview()
      if (path.startsWith('/api/analytics/routes')) return routesOverview()
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'friends'
    await render()

    // ★V7 h99Gb：棒は列全体のボタンになり、読み上げ名は「9月9日（水） 増えた5人・減った2人」。
    // 意図は同じ（日付と増減が読める・選んだ日が分かる）。
    const dayBar = host.querySelector('button[aria-label="9月9日（水） 増えた5人・減った2人"]') as HTMLButtonElement | null
    expect(dayBar).not.toBeNull()
    expect(dayBar?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => { dayBar?.click(); await Promise.resolve() })
    expect(dayBar?.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('増加 5人・減少 2人')
  })

  it('時間帯の棒は1本ごとに時間と回数の名前を持つ', async () => {
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/analytics/reactions')) return reactionsOverview()
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'reactions'
    await render()

    expect(host.querySelector('[role="img"][aria-label="9時台 4回"]')).not.toBeNull()
    expect(host.querySelector('[role="img"][aria-label="0時台 0回"]')).not.toBeNull()
  })

  it('ファネルの段の棒は、人数・通過率の行と紐づいている', async () => {
    net.handler = withStaff(async (path) => {
      if (path.startsWith('/api/analytics/funnels?')) return { success: true, data: FUNNELS }
      if (path.includes('/runs/latest?')) return { success: true, data: funnelRun() }
      throw new Error(`未設定: ${path}`)
    })
    fixture.tab = 'funnel'
    await render()
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    const bar = host.querySelector('button[aria-label="案内の段"]') as HTMLButtonElement | null
    expect(bar).not.toBeNull()
    const describedBy = bar?.getAttribute('aria-describedby')
    expect(describedBy).toBe('funnel-step-1-value')
    const value = host.querySelector(`#${describedBy}`)
    expect(value?.textContent).toContain('10 人')
  })
})
