// @vitest-environment happy-dom
/*
 * V6R-S1-a: 対応マーク機能の有効が後から分かっても、ほかの補足データを取り直さない。
 *
 * 検証環境の実測では、表示可否（/api/settings/features/visibility）が届いて
 * 対応マークが有効と分かった瞬間に、写真・予約・予約集計・健全性・職員一覧まで
 * 2回目を取りに行っていた（ダッシュボードで28本中7種が2回）。
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
  search: '',
}))

type Json = { status: number; body: unknown }
const ok = (body: unknown): Json => ({ status: 200, body })
const fail = (status = 404): Json => ({ status, body: { success: false, error: 'not available' } })
const pending = (): Promise<Json> => new Promise<Json>(() => {})

const net = vi.hoisted(() => ({
  calls: [] as string[],
  // 健全性だけを止められるように分ける。
  health: (() => Promise.resolve(ok({ success: true, data: { riskLevel: 'normal', logs: [] } }))) as () => Promise<Json>,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) =>
    <a href={href}>{children as never}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(fixture.search),
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
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,x') } }))

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
      officialProfileUrl: { value: null, state: 'unavailable', reason: 'not_connected', asOf: null, period: 'latest' },
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
    if (path.startsWith('/api/booking/admin/requests-summary')) {
      return jsonResponse(ok({ success: true, todayActiveTotal: 1 }))
    }
    if (path.startsWith('/api/booking/admin/requests')) {
      const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString()
      return jsonResponse(ok({
        requests: [{
          id: 'bk-1', friend_id: 'friend-1', booking_customer_id: null,
          starts_at: startsAt, ends_at: startsAt, status: 'confirmed',
          customer_note: null, internal_note: null, price_at_booking: 0,
          menu_name: '相談', staff_name: '担当者', friend_name: 'テスト',
          requested_at: startsAt, decided_at: null, external_event_id: null,
        }],
        total: 1,
      }))
    }
    if (path.startsWith('/api/settings/features/visibility')) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return jsonResponse(ok({ success: true, data: { features: { support_marks: true } } }))
    }
    if (path.startsWith('/api/entry-routes')) return jsonResponse(ok({ success: true, data: [] }))
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      return jsonResponse(ok({
        success: true,
        data: { pendingCount: 3, reviewedCount: 0, averageReviewMinutes: null, oldestPendingAt: null, attentionCount: 0 },
      }))
    }
    if (path.includes('/health')) return jsonResponse(await net.health())
    if (path === '/api/staff') return jsonResponse(ok({ success: true, data: [] }))
    if (path.startsWith('/api/support-marks')) return jsonResponse(ok({ success: true, data: [] }))
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
    return jsonResponse(fail())
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

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.search = ''
  net.calls.length = 0
  net.health = () => Promise.resolve(ok({ success: true, data: { riskLevel: 'normal', logs: [] } }))
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  installFetch()
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
  await act(async () => { root.render(<DashboardPage />) })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function count(prefix: string): number {
  return net.calls.filter((call) => call.split(' ')[1]?.split('?')[0] === prefix).length
}

describe('補足データは、対応マークの判明で取り直さない（V6R-S1-a）', () => {
  it('表示可否が遅れて届き対応マークが有効になっても、各補足データは1回ずつ', async () => {
    await render()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
    await act(async () => { await Promise.resolve() })

    // 対応マークは有効と分かってから1回だけ取る。
    expect(count('/api/support-marks')).toBe(1)
    // ほかの補足データは、その判明に引きずられて取り直さない。
    expect(count('/api/nen-members/photos/review-metrics')).toBe(1)
    expect(count('/api/booking/admin/requests')).toBe(1)
    expect(count('/api/booking/admin/requests-summary')).toBe(1)
    expect(count('/api/staff')).toBe(1)
    expect(net.calls.filter((call) => /\/api\/accounts\/[^/]+\/health/.test(call)).length).toBe(1)
  })

  it('アカウントを替えたら、前のアカウントの写真の件数を出さない（DASH-03）', async () => {
    await render()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
    expect(host.textContent).toContain('確認待ち 3件')

    fixture.accountId = null
    await act(async () => { root.render(<DashboardPage />) })
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).not.toContain('確認待ち 3件')
  })
})
