// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import FriendAddSettingsPage from './page'
import ToastHost from '@/components/shared/toast'

/*
 * 初回案内の並べ替え（サクサク感 B）。キーを押した瞬間に順が変わり、
 * 裏で保存する。成功したら Toast の「元に戻す」で戻せる。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/friend-add-settings',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false,
}) }))
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>()
  return { ...original, useStaffRole: () => 'admin' }
})

const baseRule = {
  id: 'rule-a',
  accountId: 'account-a',
  friendKind: 'first_time',
  name: '案内A',
  folderName: null,
  priority: 1,
  isFallback: false,
  status: 'published',
  versionId: 'rule-a-v1',
  versionNumber: 1,
  versionStatus: 'published',
  version: 1,
  lastTestStatus: 'succeeded',
  lastTestedAt: null,
  publishedAt: null,
  matchedLast7Days: 10,
  definition: {
    routeIds: [],
    scenarioId: null,
    messageType: 'text',
    messageText: 'Aです。',
    timing: 'immediate',
    actions: [],
    friendCondition: null,
    activeFrom: null,
    activeUntil: null,
    weekdays: [1, 2, 3, 4, 5, 6, 0],
    timeWindows: [],
    resendSuppressionHours: 24,
    deliveryChoices: { sendWelcomeMessage: true, startScenario: false, runActions: false },
    unknownRouteAction: { sendCommonGuidance: false, notifyStaff: false },
  },
  routeNames: [],
  scenarioName: null,
}

const listData = {
  items: [
    baseRule,
    { ...baseRule, id: 'rule-b', name: '案内B', priority: 2 },
  ],
  total: 2,
  nextCursor: null,
  folderCounts: [],
  summary: { rules: 2, active: 2, recentAdds: 5, captured: 5, unknownRoute: 0, delivered: 5, failed: 0 },
  options: { routes: [], scenarios: [], tags: [], folders: [] },
}

const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

let root: Root
let host: HTMLDivElement
const reorderBodies: string[] = []
let resolveReorder: ((value: Response) => void) | null = null

beforeEach(() => {
  reorderBodies.length = 0
  resolveReorder = null
  const values = new Map<string, string>()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: 'admin' } })
    if (url.pathname === '/api/friend-add-rules') {
      return response({ success: true, data: listData })
    }
    if (url.pathname === '/api/friend-add-rules/reorder') {
      reorderBodies.push(typeof init?.body === 'string' ? init.body : '')
      return new Promise<Response>((resolve) => { resolveReorder = resolve })
    }
    return response({ success: true, data: {} })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
})

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function eventually(check: () => void, timeout = 3000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

function rowNames(): string[] {
  return [...host.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('a')?.textContent?.trim() ?? '')
}

test('キーを押した瞬間に順が変わり、保存後に元に戻せる', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<><ToastHost /><FriendAddSettingsPage /></>))
  await settle()
  await eventually(() => {
    expect(rowNames()).toEqual(['案内A', '案内B'])
  })
  /* 案内Aのつまみで下へ。裏の保存を待たずに順が変わる。 */
  const grip = host.querySelector('button[aria-label="案内Aを並び替え。上下キーで移動"]') as HTMLButtonElement
  expect(grip).toBeTruthy()
  await act(async () => {
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  })
  expect(rowNames()).toEqual(['案内B', '案内A'])
  expect(reorderBodies.length).toBe(1)
  await act(async () => {
    resolveReorder?.(response({ success: true, data: { updated: 2 } }))
    await Promise.resolve()
  })
  await eventually(() => {
    expect(document.body.textContent).toContain('元に戻す')
  })
  /* 元に戻すと前の順で保存し直し、札が戻る。 */
  const undo = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '元に戻す')
  expect(undo).toBeTruthy()
  await act(async () => { (undo as HTMLButtonElement).click() })
  expect(reorderBodies.length).toBe(2)
  await act(async () => {
    resolveReorder?.(response({ success: true, data: { updated: 2 } }))
    await Promise.resolve()
  })
  await eventually(() => {
    expect(rowNames()).toEqual(['案内A', '案内B'])
  })
})
