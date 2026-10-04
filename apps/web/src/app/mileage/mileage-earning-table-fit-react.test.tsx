// @vitest-environment happy-dom
/*
 * たまる決めごとの表（板 `OC0gy`）。器からはみ出して行末の操作が
 * 見切れないよう、固定割付＋列幅の合計 100 をここで留める。
 * happy-dom に配置計算は無いので、構造（`colgroup` の7列と幅の合計）を見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountProvider } from '@/contexts/account-context'
import MileagePage from './page'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
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

function stubFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/mileage/earning-rules')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          items: [ruleFixture()],
          pagination: { total: 1, limit: 20, offset: 0 },
          unassignedLegacyCount: 0,
          measuredAt: '2026-09-10T00:00:00.000Z',
        },
      }), { status: 200 })
    }
    if (url.includes('/api/mileage/history')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          items: [],
          pagination: { total: 0, limit: 1, offset: 0 },
          summary: { byType: [], totalAmount: 0, manualCount: 0 },
        },
      }), { status: 200 })
    }
    if (url.includes('/api/mileage/friends')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          items: [],
          summary: {
            totalMembers: 1,
            withBalanceCount: 1,
            available: 100,
            pending: 0,
            monthChange: 0,
            rankCounts: [],
            expiringMiles30d: null,
            nextExpiringAt: null,
          },
          pagination: { total: 1, limit: 1, offset: 0 },
          measuredAt: '2026-09-10T00:00:00.000Z',
        },
      }), { status: 200 })
    }
    if (url.includes('/api/staff/me')) {
      return new Response(JSON.stringify({ success: true, data: { id: 'owner-1', role: 'owner' } }), { status: 200 })
    }
    if (url.includes('/api/line-accounts')) {
      return new Response(JSON.stringify({
        success: true,
        data: [{ id: 'account-1', channelId: 'channel-1', name: '公式A', isActive: true, country: null, role: null, displayOrder: 0 }],
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
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
  installWebStorage()
  globalThis.localStorage.setItem('lh_selected_account', 'account-1')
  /* V8 の器で描く（`useAdminTheme` は `<html data-theme>` を読む）。 */
  document.documentElement.dataset.theme = 'v8'
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
  vi.restoreAllMocks()
})

async function waitForTable(): Promise<HTMLTableElement> {
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await Promise.resolve() })
    const table = container.querySelector('table')
    if (table && table.querySelector('tbody tr')) return table as HTMLTableElement
  }
  throw new Error('たまる決めごとの表が出ませんでした')
}

describe('たまる決めごとの表の器収め', () => {
  it('固定割付で先頭だけ伸び縮み・残りの幅の合計が85', async () => {
    await act(async () => {
      root.render(<AccountProvider><MileagePage /></AccountProvider>)
    })
    const table = await waitForTable()
    /* 固定割付が無いと自動割付で器より広がる。 */
    expect(table.className).toContain('tableFit')
    const cols = [...table.querySelectorAll('colgroup col')]
    expect(cols).toHaveLength(7)
    /* 先頭は伸び縮み（幅を指定しない）。 */
    expect((cols[0] as HTMLTableColElement).style.width).toBe('')
    const widths = cols.slice(1).map((col) => (col as HTMLTableColElement).style.width)
    expect(widths).toEqual(['12%', '12%', '15%', '11%', '17%', '18%'])
    const total = widths.reduce((sum, width) => sum + Number.parseFloat(width), 0)
    /* 100 を超えると器からはみ出す。 */
    expect(total).toBeLessThanOrEqual(100)
  })
})
