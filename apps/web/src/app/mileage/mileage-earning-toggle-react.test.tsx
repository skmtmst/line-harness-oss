// @vitest-environment happy-dom
/*
 * たまる決めごとの止める・動かす（サクサク感 B）。
 * 押した瞬間に札が変わり、裏で保存する。成功したら Toast の
 * 「元に戻す」で戻せる。失敗したら戻して「もう一度試す」を出す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountProvider } from '@/contexts/account-context'
import ToastHost from '@/components/shared/toast'
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

const putCalls: Array<{ url: string; body: string | null }> = []
let resolveUpdate: ((value: Response) => void) | null = null
let failUpdate = false

function updateResponse(): Response {
  return new Response(JSON.stringify({ success: !failUpdate, data: {}, error: failUpdate ? 'no' : undefined }), { status: 200 })
}

function stubFetch() {
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/mileage/rules/rule-1') && (init?.method ?? 'GET').toUpperCase() !== 'GET') {
      putCalls.push({ url, body: typeof init?.body === 'string' ? init.body : null })
      return new Promise<Response>((resolve) => { resolveUpdate = resolve })
    }
    if (url.includes('/api/mileage/earning-rules')) {
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: { items: [ruleFixture()], pagination: { total: 1, limit: 20, offset: 0 }, unassignedLegacyCount: 0, measuredAt: '2026-09-10T00:00:00.000Z' },
      }), { status: 200 }))
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
  installWebStorage()
  globalThis.localStorage.setItem('lh_selected_account', 'account-1')
  document.documentElement.dataset.theme = 'v8'
  putCalls.length = 0
  resolveUpdate = null
  failUpdate = false
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

async function waitForMenuButton(): Promise<HTMLButtonElement> {
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await Promise.resolve() })
    const button = container.querySelector('button[aria-label="あいさつでたまるのその他操作"]')
    if (button) return button as HTMLButtonElement
  }
  throw new Error('その他操作のボタンが出ませんでした')
}

async function openMenuAndToggle(): Promise<void> {
  await act(async () => { (await waitForMenuButton()).click() })
  for (let i = 0; i < 20; i += 1) {
    await act(async () => { await Promise.resolve() })
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    const item = items.find((node) => node.textContent?.trim() === '決めごとを停止' || node.textContent?.trim() === '決めごとを再開')
    if (item && !item.hasAttribute('disabled')) {
      await act(async () => { item.click() })
      return
    }
  }
  throw new Error('停止・再開の項目が出ませんでした')
}

function pillText(): string | null {
  const pills = [...container.querySelectorAll('tbody tr td')]
  const pill = pills.map((td) => td.textContent?.trim()).find((text) => text === '動いています' || text === '止めています')
  return pill ?? null
}

describe('止める・動かすの楽観保存', () => {
  it('押した瞬間に札が変わり、保存後に元に戻せる', async () => {
    await act(async () => {
      root.render(<AccountProvider><ToastHost /><MileagePage /></AccountProvider>)
    })
    await waitForMenuButton()
    expect(pillText()).toBe('動いています')
    await openMenuAndToggle()
    /* 裏の保存を待たずに札が変わる。 */
    expect(pillText()).toBe('止めています')
    expect(putCalls.length).toBe(1)
    await act(async () => {
      resolveUpdate?.(updateResponse())
      await Promise.resolve()
      await Promise.resolve()
    })
    for (let i = 0; i < 20; i += 1) {
      await act(async () => { await Promise.resolve() })
      if (document.body.textContent?.includes('元に戻す')) break
    }
    const undo = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '元に戻す')
    expect(undo).toBeTruthy()
    /* 元に戻すと再開の保存が走り、札が戻る。 */
    await act(async () => {
      undo?.click()
      await Promise.resolve()
    })
    expect(putCalls.length).toBe(2)
    expect(JSON.parse(putCalls[1]?.body ?? '{}').isActive).toBe(true)
  })

  it('保存に失敗したら札を戻して「もう一度試す」を出す', async () => {
    failUpdate = true
    await act(async () => {
      root.render(<AccountProvider><ToastHost /><MileagePage /></AccountProvider>)
    })
    await waitForMenuButton()
    await openMenuAndToggle()
    expect(pillText()).toBe('止めています')
    await act(async () => {
      resolveUpdate?.(updateResponse())
      await Promise.resolve()
      await Promise.resolve()
    })
    for (let i = 0; i < 20; i += 1) {
      await act(async () => { await Promise.resolve() })
      if (pillText() === '動いています') break
    }
    expect(pillText()).toBe('動いています')
    expect(document.body.textContent).toContain('もう一度試す')
  })
})
