// @vitest-environment happy-dom
/*
 * マイル V8 の骨組み（サクサク感 A）。読み始め0.3秒は場所だけ取り、
 * 0.3秒を超えたら見出し付き5行の骨組みを出すことを確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountProvider } from '@/contexts/account-context'
import MileagePage from './page'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=earning-rules'),
  usePathname: () => '/mileage',
}))

function ruleFixture() {
  return {
    id: 'rule-1',
    published: {
      name: 'あいさつでたまる',
      eventType: 'message_received',
      source: 'line',
      amount: 100,
      initialStatus: 'available',
      validFrom: null,
      validUntil: null,
      status: 'published',
      updatedAt: '2026-09-10T00:00:00.000Z',
    },
    draft: {
      name: 'あいさつでたまる',
      eventType: 'message_received',
      source: 'line',
      amount: 200,
      initialStatus: 'available',
      validFrom: null,
      validUntil: null,
      expiresAfterDays: null,
      cancellationEventTypes: [],
      targetConditions: null,
      sortOrder: 0,
      notification: { enabled: false, messageTemplate: '' },
    },
    draftVersion: 7,
    draftUpdatedAt: '2026-09-10T01:00:00.000Z',
    publishedVersion: 1,
    metrics30d: { eligible: 10, granted: 8, grantedMiles: 800, excluded: 2 },
  }
}

let resolveRules: ((value: Response) => void) | null = null

function stubFetch() {
  globalThis.fetch = ((input: unknown) => {
    const url = String(input)
    if (url.includes('/api/mileage/earning-rules')) {
      return new Promise<Response>((resolve) => { resolveRules = resolve })
    }
    if (url.includes('/api/mileage/history')) {
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: { items: [], pagination: { total: 0, limit: 1, offset: 0 }, summary: { byType: [], totalAmount: 0, manualCount: 0 } },
      }), { status: 200 }))
    }
    if (url.includes('/api/mileage/friends')) {
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: {
          items: [],
          summary: { totalMembers: 1, withBalanceCount: 1, available: 100, pending: 0, monthChange: 0, rankCounts: [], expiringMiles30d: null, nextExpiringAt: null },
          pagination: { total: 1, limit: 1, offset: 0 },
          measuredAt: '2026-09-10T00:00:00.000Z',
        },
      }), { status: 200 }))
    }
    if (url.includes('/api/line-accounts')) {
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: [{ id: 'account-1', channelId: 'channel-1', name: '公式A', isActive: true, country: null, role: null, displayOrder: 0 }],
      }), { status: 200 }))
    }
    if (url.includes('/api/staff/me')) {
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: 'owner-1', role: 'owner' } }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }))
  }) as typeof globalThis.fetch
}

let container: HTMLDivElement
let root: Root
const originalFetch = globalThis.fetch

function installWebStorage(): void {
  const make = () => {
    const data = new Map<string, string>()
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, String(value)) },
      removeItem: (key: string) => { data.delete(key) },
      clear: () => { data.clear() },
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size },
    }
  }
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const holder = globalThis as unknown as Record<string, unknown>
    if (!holder[name]) {
      Object.defineProperty(globalThis, name, { value: make(), configurable: true })
    }
  }
}

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  vi.useFakeTimers()
  installWebStorage()
  globalThis.localStorage.setItem('lh_selected_account', 'account-1')
  document.documentElement.dataset.theme = 'v8'
  resolveRules = null
  stubFetch()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  document.body.innerHTML = ''
  globalThis.fetch = originalFetch
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function rulesResponse(): Response {
  return new Response(JSON.stringify({
    success: true,
    data: { items: [ruleFixture()], pagination: { total: 1, limit: 20, offset: 0 }, unassignedLegacyCount: 0, measuredAt: '2026-09-10T00:00:00.000Z' },
  }), { status: 200 })
}

describe('たまる決めごとの骨組み', () => {
  it('0.3秒を超えたら見出し付き5行の骨組み→本物の表に入れ替わる', async () => {
    await act(async () => {
      root.render(<AccountProvider><MileagePage /></AccountProvider>)
    })
    /* 読み始め直後は骨組みを出さない（場所だけ取る）。 */
    expect(container.querySelector('[data-skeleton]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(350) })
    /* 見出しは本物、行は骨組み5行。 */
    const skeletonTable = container.querySelector('[aria-busy="true"] table')
    expect(skeletonTable?.querySelectorAll('thead th').length).toBe(7)
    expect(skeletonTable?.querySelectorAll('tbody tr').length).toBe(5)
    expect(skeletonTable?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
    /* 応答が来たら本物の表に入れ替わる（最低表示0.4秒を過ぎたら）。 */
    await act(async () => {
      resolveRules?.(rulesResponse())
      for (let i = 0; i < 12; i += 1) {
        vi.advanceTimersByTime(100)
        await Promise.resolve()
        await Promise.resolve()
      }
    })
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(100)
        await Promise.resolve()
        await Promise.resolve()
      })
      if (container.querySelector('tbody tr td p[title="あいさつでたまる"]')) break
    }
    expect(container.querySelector('tbody tr td p[title="あいさつでたまる"]')?.textContent).toBe('あいさつでたまる')
  })
})
