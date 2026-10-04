// @vitest-environment happy-dom
/*
 * 友だちの残高（板 `CJlf4`）。絵の骨組み（`design/v8/html/CJlf4.html`）にそろえる。
 * 頭の CSV の空け・数の帯の空け（今月 増えた・今月 減った）・申請の行
 * （申請 佐藤 直人（10/2 15:20））・申請した人の言い方をここで留める。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountProvider } from '@/contexts/account-context'
import V8BalancesTab from './v8-balances-tab'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=balances'),
  usePathname: () => '/mileage',
}))

function stubFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/mileage/adjustment-approvals')) {
      return new Response(JSON.stringify({
        success: true,
        data: [{
          id: 'approval-1',
          line_account_id: 'account-1',
          friend_id: 'friend-1',
          friend_display_name: 'Kenta Kawano',
          direction: 'increase',
          amount: 5000,
          reason_category: 'other',
          reason: 'イベント運営のお礼',
          status: 'pending',
          requested_by_staff_id: 'staff-2',
          requested_by_staff_name: '佐藤 直人',
          decided_by_staff_name: null,
          decided_at: null,
          decision_reason: null,
          created_at: '2026-10-02T06:20:00.000Z',
        }],
      }), { status: 200 })
    }
    if (url.includes('/api/mileage/history')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          items: [],
          pagination: { total: 0, limit: 1, offset: 0 },
          summary: {
            byType: [
              { entryType: 'grant', count: 1, amount: 40800 },
              { entryType: 'spend', count: 1, amount: -33100 },
            ],
            totalAmount: 7700,
            manualCount: 0,
          },
        },
      }), { status: 200 })
    }
    if (url.includes('/api/mileage/friends')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          items: [{
            friendId: 'friend-1',
            displayName: 'Kenta Kawano',
            pictureUrl: null,
            rank: 'gold',
            rankReason: '',
            rankThreshold: null,
            nextRank: null,
            nextRankThreshold: null,
            milesToNextRank: null,
            monthChange: 428,
            available: 2340,
            pending: 128,
            expiringMiles30d: 120,
            nextExpiringAt: null,
            lifetimeEarned: 3000,
            spent: 660,
            lastChangedAt: '2026-09-30T00:00:00.000Z',
            walletScope: 'friend',
            lineAccount: { id: 'account-1', name: '然 -NEN- 本店' },
          }],
          summary: {
            totalMembers: 1284,
            withBalanceCount: 1102,
            available: 286400,
            pending: 128,
            monthChange: 7700,
            rankCounts: [],
            expiringMiles30d: null,
            nextExpiringAt: null,
          },
          pagination: { total: 1, limit: 20, offset: 0 },
          measuredAt: '2026-10-02T00:00:00.000Z',
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
let headerNode: React.ReactNode
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
  document.documentElement.dataset.theme = 'v8'
  headerNode = null
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

async function waitForRows(): Promise<void> {
  await act(async () => {
    root.render(
      <AccountProvider>
        <V8BalancesTab
          readonly={false}
          registerHeaderActions={(node) => { headerNode = node }}
          registerTabCount={() => {}}
        />
      </AccountProvider>,
    )
  })
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await Promise.resolve() })
    if (container.querySelector('tbody tr')) return
  }
  throw new Error('残高の表が出ませんでした')
}

describe('残高の絵合わせ（板 `CJlf4`）', () => {
  it('数の帯は空けて書く（今月 増えた・今月 減った）', async () => {
    await waitForRows()
    const body = container.textContent ?? ''
    expect(body).toContain('今月 増えた')
    expect(body).toContain('今月 減った')
    expect(body).not.toContain('今月増えた')
    expect(body).not.toContain('今月減った')
  })

  it('申請の行に頼んだ人と日時が出る', async () => {
    await waitForRows()
    const body = container.textContent ?? ''
    expect(body).toContain('承認待ちのマイル変更 1件')
    expect(body).toContain('申請 佐藤 直人（10/2 15:20）')
    expect(body).toContain('申請した人とは別のオーナー')
  })

  it('頭の CSV と脚注は空けて書く', async () => {
    await waitForRows()
    expect(headerNode).not.toBeNull()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const headerRoot = createRoot(host)
    await act(async () => { headerRoot.render(<>{headerNode}</>) })
    expect(host.textContent ?? '').toContain('この頁の残高を CSV')
    await act(async () => { headerRoot.unmount() })
    host.remove()
    expect(container.textContent ?? '').toContain('CSV はこのページの残高を書き出します')
  })
})
