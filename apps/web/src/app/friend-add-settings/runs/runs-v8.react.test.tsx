// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import FriendAddRunsPage from './page'

/*
 * ★V8 友だち追加時の配信の実行結果（板 `REIxB`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい実行結果に切り替わり、
 * 数の帯・失敗の帯・表・下の2枚が出ることを実DOMで固定する。
 * v7 では従来の実行結果が出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/friend-add-settings/runs',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a',
  selectedAccount: null,
  loading: false,
  accounts: [{ id: 'account-a' }],
}) }))
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>()
  return { ...original, useStaffRole: () => 'admin' }
})

let root: Root
let host: HTMLDivElement
const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

const runsData = {
  items: [
    {
      id: 'run-ok',
      receivedAt: '2026-09-07T10:14:01',
      processedAt: '2026-09-07T10:14:02',
      friend: { id: 'friend-1', displayName: '山田 太郎', redacted: false },
      friendKind: 'first_time',
      attribution: { status: 'unavailable', routeId: null, routeName: null, reason: null },
      rule: { id: 'rule-fallback', name: '経路が分からなかった人', versionId: 'v1', versionNumber: 1 },
      scenario: { id: 'scenario-common', name: '共通のあいさつ', enrollmentId: 'en-1', started: true },
      actions: { total: 2, failed: 0 },
      deliveryCount: 1,
      status: 'completed',
      errorCode: null,
    },
    {
      id: 'run-failed',
      receivedAt: '2026-09-07T10:14:01',
      processedAt: '2026-09-07T10:14:03',
      friend: { id: 'friend-2', displayName: '佐藤 花子', redacted: false },
      friendKind: 'first_time',
      attribution: { status: 'unavailable', routeId: null, routeName: null, reason: null },
      rule: { id: 'rule-fallback', name: '経路が分からなかった人', versionId: 'v1', versionNumber: 1 },
      scenario: { id: 'scenario-common', name: '共通のあいさつ', enrollmentId: null, started: false },
      actions: { total: 3, failed: 1 },
      deliveryCount: 1,
      status: 'failed',
      errorCode: 'action_failed',
    },
  ],
  total: 2,
  nextCursor: null,
  summary: {
    recentFriends: 214,
    recentEvents: 214,
    cumulativeDeliveries: 1842,
    scenarioStarts: 198,
    averageSendTimeMs: 600,
    failed: 1,
    lastDeliveryAt: '2026-09-07T10:32:00',
    staffHandoffs: { value: null, state: 'unavailable', reason: null },
  },
}

function base(url: URL) {
  if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: 'admin' } })
  if (url.pathname === '/api/friend-add-runs') return response({ success: true, data: runsData })
  return response({ success: true, data: {} })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

beforeEach(() => {
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
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return base(url)
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

test('v8 の実行結果は板 REIxB・数の帯・失敗の帯・表・下の2枚が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddRunsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="REIxB"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('実行結果：友だち追加時の配信')
  expect(host.textContent).toContain('失敗した処理が')
  expect(host.textContent).toContain('山田 太郎')
  expect(host.textContent).toContain('経路ごとの内訳')
  expect(host.textContent).toContain('二重送信を防ぐ・知らせ')
})

test('v7 の下では従来の実行結果が出る（REIxBには切り替わらない）', async () => {
  await act(async () => root.render(<FriendAddRunsPage />))
  await settle()
  await eventually(() => {
    expect(host.textContent).toContain('最近の友だち追加')
  })
  expect(host.querySelector('[data-design-node="REIxB"]')).toBeNull()
})
