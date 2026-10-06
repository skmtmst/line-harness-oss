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
import V8BalancesTab from './v8-balances-tab'
import V8RewardsTab from './v8-rewards-tab'

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
      validUntil: '2026-12-31T00:00:00.000Z',
      expiresAfterDays: 365,
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

function rewardFixture(id: string) {
  return {
    id,
    lineAccountId: 'account-1',
    programId: 'program-1',
    name: `使い道${id}`,
    description: null,
    imageUrl: null,
    rewardKind: 'coupon' as const,
    status: 'published' as const,
    sortOrder: 0,
    currentDraftVersionId: null,
    currentPublishedVersionId: null,
    currentVersion: null,
    exchangedThisMonth: 0,
    availableCodeCount: null,
    benefitName: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  }
}

const createdRulePayloads: Array<unknown> = []

function stubFetch() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/api/mileage/rules') && method === 'POST') {
      createdRulePayloads.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({ success: true, data: { id: 'rule-new' } }), { status: 200 })
    }
    if (url.includes('/api/mileage/earning-rules/') && url.includes('/draft') && method !== 'GET') {
      return new Response(JSON.stringify({ success: true, data: { ruleId: 'rule-new' } }), { status: 200 })
    }
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
    if (url.includes('/api/mileage/rewards')) {
      return new Response(JSON.stringify({
        success: true,
        data: { rewards: [rewardFixture('reward-1'), rewardFixture('reward-2')] },
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
  createdRulePayloads.length = 0
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

/*
 * タブの名の横の件数（板 `OC0gy`：たまる決めごと・使い道・
 * 友だちの残高）。数は各タブの読み物から来る。読み直し中・失敗時は出さない。
 */
async function waitForTabCount(calls: Array<{ key: string; text: string | null }>, key: string, text: string) {
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await Promise.resolve() })
    if (calls.some((call) => call.key === key && call.text === text)) return
  }
  throw new Error(`タブの件数が出ませんでした: ${key} ${text}`)
}

describe('有効期間の短さ（板 `E2Any`）', () => {
  it('1年・12/31 と出す', async () => {
    await act(async () => {
      root.render(<AccountProvider><MileagePage /></AccountProvider>)
    })
    await waitForTable()
    expect(container.textContent ?? '').toContain('1年・12/31')
  })
})

describe('行の「…」（板 `OC0gy`）', () => {
  it('編集・止める・複製が並び、複製は止めた状態で写しを作る', async () => {
    await act(async () => {
      root.render(<AccountProvider><MileagePage /></AccountProvider>)
    })
    await waitForTable()
    const menuButton = [...container.querySelectorAll('button')].find(
      (element) => element.getAttribute('aria-label') === 'あいさつでたまるのその他操作',
    )
    if (!(menuButton instanceof HTMLButtonElement)) throw new Error('その他操作のボタンがありません')
    await act(async () => { menuButton.click() })
    const menu = document.body.textContent ?? ''
    expect(menu).toContain('編集')
    /* 動いている見本なので止める側が出る。 */
    expect(menu).toContain('止める')
    expect(menu).toContain('複製')
    const duplicate = [...document.body.querySelectorAll('button')].find(
      (element) => element.textContent === '複製',
    )
    if (!(duplicate instanceof HTMLButtonElement)) throw new Error('複製の項目がありません')
    await act(async () => { duplicate.click() })
    for (let i = 0; i < 60; i += 1) {
      await act(async () => { await Promise.resolve() })
      if (createdRulePayloads.length > 0) break
    }
    expect(createdRulePayloads).toHaveLength(1)
    const payload = createdRulePayloads[0] as { name: string; isActive: boolean }
    expect(payload.name).toContain('のコピー')
    expect(payload.isActive).toBe(false)
    for (let i = 0; i < 60; i += 1) {
      await act(async () => { await Promise.resolve() })
      if ((container.textContent ?? '').includes('止めた状態で作りました')) break
    }
    expect(container.textContent ?? '').toContain('止めた状態で作りました')
  })
})

describe('タブの名の横の件数', () => {
  it('たまる決めごとは読み物の件数が殻のタブに出る', async () => {
    await act(async () => {
      root.render(<AccountProvider><MileagePage /></AccountProvider>)
    })
    await waitForTable()
    /* 見本1件 → 「たまる決めごと 1」。 */
    const nav = container.querySelector('nav')
    expect(nav?.textContent).toContain('たまる決めごと 1')
  })

  it('使い道は読み物の件数を殻へ載せる', async () => {
    const calls: Array<{ key: string; text: string | null }> = []
    await act(async () => {
      root.render(
        <AccountProvider>
          <V8RewardsTab
            readonly={false}
            registerHeaderActions={() => {}}
            registerTabCount={(key, text) => { calls.push({ key, text }) }}
          />
        </AccountProvider>,
      )
    })
    /* 見本2件 → 「使い道 2」。 */
    await waitForTabCount(calls, 'rewards', '2')
  })

  it('友だちの残高は人数を殻へ載せる', async () => {
    const calls: Array<{ key: string; text: string | null }> = []
    await act(async () => {
      root.render(
        <AccountProvider>
          <V8BalancesTab
            readonly={false}
            registerHeaderActions={() => {}}
            registerTabCount={(key, text) => { calls.push({ key, text }) }}
          />
        </AccountProvider>,
      )
    })
    /* 見本の人数1 → 「友だちの残高 1」。 */
    await waitForTabCount(calls, 'balances', '1')
  })
})
