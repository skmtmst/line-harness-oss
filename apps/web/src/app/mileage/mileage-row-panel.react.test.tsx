// @vitest-environment happy-dom
/*
 * V8「サクサク感」C①②・D・E：マイル（たまる決めごと）の一覧の行パネル。
 * 行を押すと右に詳細パネル（↑↓で次の行）。「下書きを編集」は編集画面へ進む。
 * 名前のその場の書き換えは無し（名前は編集画面の下書きで変えるため）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pushes: string[] = []
let mileageTab = 'earning-rules'
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push(url: string) { pushes.push(url) }, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${mileageTab}`),
  usePathname: () => '/mileage',
}))

import { AccountProvider } from '@/contexts/account-context'
import MileagePage from './page'

function ruleFixture(id: string, name: string) {
  return {
    id,
    published: {
      name,
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
      name,
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
  globalThis.fetch = ((input: unknown) => {
    const url = String(input)
    if (url.includes('/api/mileage/earning-rules')) {
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: { items: [ruleFixture('rule-1', 'あいさつでたまる'), ruleFixture('rule-2', '来店でたまる')], pagination: { total: 2, limit: 20, offset: 0 }, unassignedLegacyCount: 0, measuredAt: '2026-09-10T00:00:00.000Z' },
      }), { status: 200 }))
    }
    if (url.includes('/api/mileage/history')) {
      const entry = (id: string, name: string, friendId: string) => ({
        id, primaryFriendId: friendId, displayName: name, pictureUrl: null,
        entryType: 'grant', status: 'available', amount: 200, reason: '来店特典',
        source: 'line', sourceEventId: null, sourceReferenceId: null, ruleName: '来店でたまる',
        mode: 'automatic', executedByStaffName: null, balanceAfter: 1400,
        occurredAt: '2026-09-20T10:00:00.000Z', lineAccountId: 'account-1', lineAccountName: '公式A',
      })
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: {
          items: [entry('h1', '履歴花子', 'bf-1'), entry('h2', '履歴次郎', 'bf-2')],
          pagination: { total: 2, limit: 20, offset: 0 },
          summary: { from: null, to: null, byType: [] },
        },
      }), { status: 200 }))
    }
    if (url.includes('/api/mileage/friends')) {
      const member = (friendId: string, displayName: string) => ({
        friendId, displayName, pictureUrl: null, rank: 'gold', rankReason: '',
        rankThreshold: 0, nextRank: null, nextRankThreshold: null, milesToNextRank: null,
        monthChange: 100, available: 1200, pending: 0, expiringMiles30d: null, nextExpiringAt: null,
        lifetimeEarned: 5000, spent: 100, lastChangedAt: '2026-09-20',
        walletScope: 'friend', lineAccount: { id: 'account-1', name: '公式A' },
      })
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: {
          items: [member('bf-1', '残高花子'), member('bf-2', '残高次郎')],
          summary: { totalMembers: 2, withBalanceCount: 2, available: 2400, pending: 0, monthChange: 200, rankCounts: [], expiringMiles30d: null, nextExpiringAt: null },
          pagination: { total: 2, limit: 20, offset: 0 },
          measuredAt: '2026-09-10T00:00:00.000Z',
        },
      }), { status: 200 }))
    }
    if (url.includes('/api/action-scores/friends')) {
      const scored = (friendId: string, displayName: string) => ({
        friendId, displayName, pictureUrl: null, currentScore: 80, band: 'high',
        change30d: 5, lastReason: '来店', lastChangedAt: '2026-09-20',
      })
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: {
          summary: { scoredFriends: 2, high: 2, normal: 0, low: 0, decreased30d: 0, highMin: 70, normalMin: 40 },
          items: [scored('bf-1', '点数花子'), scored('bf-2', '点数次郎')],
          pagination: { total: 2, limit: 20, offset: 0 },
        },
      }), { status: 200 }))
    }
    if (url.includes('/api/mileage/rewards')) {
      const reward = (id: string, name: string) => ({
        id, lineAccountId: 'account-1', programId: 'p1', name, description: null, imageUrl: null,
        rewardKind: 'coupon', status: 'published', sortOrder: 0,
        currentDraftVersionId: null, currentPublishedVersionId: 'v1',
        currentVersion: { requiredMiles: 500 },
        exchangedThisMonth: 3, availableCodeCount: null,
        benefitName: '500円引き',
      })
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: {
          rewards: [reward('rw-1', '交換クーポンA'), reward('rw-2', '交換クーポンB')],
          summary: { publishedCount: 2, redeemedMilesThisMonth: 1500, unredeemedCount: 0 },
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
  installWebStorage()
  globalThis.localStorage.setItem('lh_selected_account', 'account-1')
  document.documentElement.dataset.theme = 'v8'
  mileageTab = 'earning-rules'
  pushes.length = 0
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

async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

async function openFirstRow() {
  await act(async () => { root.render(<AccountProvider><MileagePage /></AccountProvider>) })
  await eventually(() => {
    if (!container.textContent?.includes('あいさつでたまる')) throw new Error('row not loaded')
  })
  const rows = [...container.querySelectorAll('tbody tr')]
  const firstRow = rows.find((tr) => tr.textContent?.includes('あいさつでたまる'))
  if (!firstRow) throw new Error('no rows')
  await act(async () => {
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await Promise.resolve() })
}

describe('マイルV8の行パネル（C・D・E）', () => {
  it('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
    await openFirstRow()
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel || !panel.textContent?.includes('あいさつでたまる')) throw new Error('panel not open')
    })
    const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel?.textContent?.includes('来店でたまる')) throw new Error('did not move')
    })
  })

  it('パネルの「下書きを編集」は編集画面へ進む', async () => {
    await openFirstRow()
    await eventually(() => {
      if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
    })
    const edit = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '下書きを編集')
    if (!edit) throw new Error('no edit button')
    await act(async () => { edit.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(pushes).toEqual(['/mileage/earning-rules/edit?id=rule-1'])
  })
})

describe('マイルV8使い道の行パネル（C・D・E）', () => {
  it('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
    mileageTab = 'rewards'
    await act(async () => { root.render(<AccountProvider><MileagePage /></AccountProvider>) })
    await eventually(() => {
      if (!container.textContent?.includes('交換クーポンA')) throw new Error('row not loaded')
    })
    const rows = [...container.querySelectorAll('tbody tr')]
    const firstRow = rows.find((tr) => tr.textContent?.includes('交換クーポンA'))
    if (!firstRow) throw new Error('no rows')
    await act(async () => {
      firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel || !panel.textContent?.includes('交換クーポンA')) throw new Error('panel not open')
    })
    const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel?.textContent?.includes('交換クーポンB')) throw new Error('did not move')
    })
  })

  it('パネルの「中身を見る」は編集画面へ進む', async () => {
    mileageTab = 'rewards'
    await act(async () => { root.render(<AccountProvider><MileagePage /></AccountProvider>) })
    await eventually(() => {
      if (!container.textContent?.includes('交換クーポンA')) throw new Error('row not loaded')
    })
    const rows = [...container.querySelectorAll('tbody tr')]
    const firstRow = rows.find((tr) => tr.textContent?.includes('交換クーポンA'))
    if (!firstRow) throw new Error('no rows')
    await act(async () => {
      firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await eventually(() => {
      if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
    })
    const detail = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '中身を見る')
    if (!detail) throw new Error('no detail button')
    await act(async () => { detail.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(pushes).toEqual(['/mileage/rewards/edit?id=rw-1'])
  })
})

async function openRowInTab(tab: string, firstName: string) {
  mileageTab = tab
  await act(async () => { root.render(<AccountProvider><MileagePage /></AccountProvider>) })
  await eventually(() => {
    if (!container.textContent?.includes(firstName)) throw new Error('row not loaded')
  })
  const rows = [...container.querySelectorAll('tbody tr')]
  const firstRow = rows.find((tr) => tr.textContent?.includes(firstName))
  if (!firstRow) throw new Error('no rows')
  await act(async () => {
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await Promise.resolve() })
}

describe('マイルV8残高の行パネル（C・D・E）', () => {
  it('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
    await openRowInTab('balances', '残高花子')
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel || !panel.textContent?.includes('残高花子')) throw new Error('panel not open')
    })
    const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel?.textContent?.includes('残高次郎')) throw new Error('did not move')
    })
  })

  it('パネルの「明細を見る」は明細画面へ進む', async () => {
    await openRowInTab('balances', '残高花子')
    await eventually(() => {
      if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
    })
    const detail = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '明細を見る')
    if (!detail) throw new Error('no detail button')
    await act(async () => { detail.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(pushes).toEqual(['/mileage/friends/detail?id=bf-1'])
  })
})

describe('マイルV8履歴の行パネル（C・D・E）', () => {
  it('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
    await openRowInTab('history', '履歴花子')
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel || !panel.textContent?.includes('履歴花子')) throw new Error('panel not open')
    })
    const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel?.textContent?.includes('履歴次郎')) throw new Error('did not move')
    })
  })

  it('パネルの「友だちを見る」は明細画面へ進む', async () => {
    await openRowInTab('history', '履歴花子')
    await eventually(() => {
      if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
    })
    const detail = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '友だちを見る')
    if (!detail) throw new Error('no detail button')
    await act(async () => { detail.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(pushes).toEqual(['/mileage/friends/detail?id=bf-1'])
  })
})

describe('マイルV8スコアの行パネル（C・D・E）', () => {
  it('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
    await openRowInTab('score', '点数花子')
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel || !panel.textContent?.includes('点数花子')) throw new Error('panel not open')
    })
    const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel?.textContent?.includes('点数次郎')) throw new Error('did not move')
    })
  })

  it('パネルの「この人を見る」は友だち詳細へ進む', async () => {
    await openRowInTab('score', '点数花子')
    await eventually(() => {
      if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
    })
    const detail = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'この人を見る')
    if (!detail) throw new Error('no detail button')
    await act(async () => { detail.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(pushes).toEqual(['/friends/detail?id=bf-1'])
  })
})
