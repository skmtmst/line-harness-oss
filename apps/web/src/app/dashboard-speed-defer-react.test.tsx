// @vitest-environment happy-dom
/*
 * V8 速さ対応：起動時は概要・配置だけを先に取り、補足の口は
 * 右の列が見えてから叩く。v7 は今までどおりすぐ叩く。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import DashboardPage from './page'

const fixture = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
}))

type Json = { status: number; body: unknown }
const ok = (body: unknown): Json => ({ status: 200, body })

const net = vi.hoisted(() => ({
  calls: [] as string[],
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) =>
    <a href={href}>{children as never}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: fixture.accountId,
    selectedAccount: fixture.accountId
      ? { id: fixture.accountId, channelId: `ch-${fixture.accountId}`, displayName: `${fixture.accountId}店`, basicId: 'nen' }
      : null,
    loading: false,
  }),
}))

const jsonResponse = ({ status, body }: Json) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const overview = ok({
  success: true,
  data: {
    period: 'today',
    generatedAt: '2026-09-20T00:00:00.000Z',
    asOf: '2026-09-20T00:00:00.000Z',
    freshness: 'fresh',
    friends: { active: 10, total: 10, blockedByThem: 0, hiddenByUs: 0, blockedBoth: 0 },
    inbox: { unanswered: 0, inProgress: 0, resolved: 0, oldestUnansweredMinutes: null, averageFirstReplyMinutes: null },
    delivery: { sent: 0, push: 0, reply: 0, broadcasts: 0, quotaLimit: null, quotaUsed: null },
    trend: [],
    conversions: { total: 0, byPoint: [] },
    partialFailures: [],
    sections: {},
    metrics: {
      activeFriends: { value: 10, state: 'available', reason: null, asOf: '2026-09-20T00:00:00.000Z', period: 'latest' },
      monthlyQuota: { value: null, state: 'unavailable', reason: 'not_connected', asOf: null, period: 'this-month' },
      friendTrend: { value: [], state: 'available', reason: null, asOf: null, period: 'today' },
      officialProfileUrl: { value: null, state: 'unavailable', reason: 'not_connected', asOf: null, period: 'this-month' },
    },
  },
})

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path.startsWith('/api/dashboard/overview')) return jsonResponse(overview)
    if (path.startsWith('/api/dashboard/preferences')) {
      return jsonResponse(ok({ success: true, data: { version: 0, cards: null } }))
    }
    if (path.startsWith('/api/dashboard/upcoming')) {
      return jsonResponse(ok({ success: true, data: { items: [], asOf: '2026-09-20T00:00:00.000Z', rangeDays: 7 } }))
    }
    if (path.startsWith('/api/dashboard/delivery-failure-origins')) {
      return jsonResponse(ok({ success: true, data: { total: 0, origins: [], asOf: '2026-09-20T00:00:00.000Z' } }))
    }
    if (path.startsWith('/api/settings/features/visibility')) {
      return jsonResponse(ok({ success: true, data: { features: { support_marks: true } } }))
    }
    if (path.startsWith('/api/entry-routes')) return jsonResponse(ok({ success: true, data: [] }))
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      return jsonResponse(ok({
        success: true,
        data: { pendingCount: 3, reviewedCount: 0, averageReviewMinutes: null, oldestPendingAt: null, attentionCount: 0 },
      }))
    }
    if (path.includes('/health')) {
      return jsonResponse(ok({ success: true, data: { riskLevel: 'normal', logs: [] } }))
    }
    if (path === '/api/staff') return jsonResponse(ok({ success: true, data: [] }))
    if (path.startsWith('/api/support-marks')) return jsonResponse(ok({ success: true, data: [] }))
    if (path.startsWith('/api/booking/admin/requests-summary')) {
      return jsonResponse(ok({ success: true, todayActiveTotal: 1 }))
    }
    if (path.startsWith('/api/booking/admin/requests')) {
      return jsonResponse(ok({ requests: [], total: 0 }))
    }
    if (path.startsWith('/api/notifications/center')) {
      return jsonResponse(ok({
        success: true,
        data: { items: [], counts: { all: 0, error: 0, update: 0, unread: 0 }, unreadCount: 0 },
      }))
    }
    if (path.startsWith('/api/support/inbox')) {
      return jsonResponse(ok({
        success: true,
        data: { items: [], summary: { total: 0, line: 0, email: 0, oldestWaitMinutes: null } },
      }))
    }
    if (path.startsWith('/api/ec-commerce/shipments')) {
      return jsonResponse(ok({
        success: true,
        data: { today: '2026-09-20', tomorrow: '2026-09-21', soon: [], later: [], soonCount: 0, laterCount: 0, scanned: 0, scanLimit: 50 },
      }))
    }
    return jsonResponse({ status: 404, body: { success: false, error: 'not available' } })
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

/* 画面の交差監視を手で動かす。最初は「右の列はまだ見えていない」。 */
const observers = vi.hoisted(() => ({
  callbacks: [] as Array<(entries: Array<{ isIntersecting: boolean }>) => void>,
}))
function installIntersectionObserver() {
  observers.callbacks.length = 0
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      observers.callbacks.push(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  })
}
async function revealAside() {
  await act(async () => {
    for (const callback of observers.callbacks) callback([{ isIntersecting: true }])
  })
  await act(async () => { await Promise.resolve() })
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.accountId = 'account-a'
  net.calls.length = 0
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  installFetch()
  installIntersectionObserver()
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => { root.render(<DashboardPage />) })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function called(substring: string): boolean {
  return net.calls.some((call) => call.includes(substring))
}

/* 職員一覧は `GET /api/staff` そのもの。本人確認の `/api/staff/me` と分ける。 */
function calledStaffList(): boolean {
  return net.calls.some((call) => call === 'GET /api/staff')
}

describe('V8 速さ対応：補足の口は右の列が見えてから', () => {
  it('起動時は概要・配置だけを取り、補足は右の列が見えるまで待つ', async () => {
    await render()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })

    expect(called('/api/dashboard/overview')).toBe(true)
    expect(called('/api/dashboard/preferences')).toBe(true)
    // 右の列が見える前は、補足の口を叩かない。
    expect(called('/api/nen-members/photos/review-metrics')).toBe(false)
    expect(called('/api/booking/admin/requests')).toBe(false)
    expect(called('/api/booking/admin/requests-summary')).toBe(false)
    expect(called('/health')).toBe(false)
    expect(calledStaffList()).toBe(false)
    expect(called('/api/support-marks')).toBe(false)
    expect(called('/api/dashboard/upcoming')).toBe(false)
    expect(called('/api/dashboard/delivery-failure-origins')).toBe(false)

    await revealAside()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })

    // 右の列が見えたら、補足の口を叩く。
    expect(called('/api/nen-members/photos/review-metrics')).toBe(true)
    expect(called('/api/booking/admin/requests')).toBe(true)
    expect(called('/api/booking/admin/requests-summary')).toBe(true)
    expect(called('/health')).toBe(true)
    expect(calledStaffList()).toBe(true)
    expect(called('/api/support-marks')).toBe(true)
    expect(called('/api/dashboard/upcoming')).toBe(true)
    expect(called('/api/dashboard/delivery-failure-origins')).toBe(true)
  })
})
