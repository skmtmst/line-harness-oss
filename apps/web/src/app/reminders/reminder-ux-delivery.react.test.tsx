// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import RemindersPage from './page'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/reminders',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false,
}) }))

let root: Root
let host: HTMLDivElement
const calls: { method: string; path: string }[] = []
let listItems: unknown[] = []

const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

function item(id: string, name: string, isActive: boolean, lifecycleStatus: string) {
  return {
    id, name, description: null, isActive, lifecycleStatus,
    triggerType: 'friend_field', deliveryMode: 'time', triggerOffsetMinutes: 0,
    sendAtTime: '09:00', folderId: null, stepCount: 1,
    timingSummary: '基準日の 3日前 09:00', hasFailure: false,
    plannedDeliveries: 2, failedCount: 0, nextScheduledAt: '2026-10-10 09:00',
    displayOrder: 0, createdAt: '2026-09-01 00:00', updatedAt: '2026-09-02 00:00',
  }
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  calls.length = 0
  listItems = [
    item('r1', '止まっている方', false, 'stopped'),
    item('r2', '動いている方', true, 'published'),
  ]
  const values = new Map<string, string>()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    calls.push({ method: init?.method ?? 'GET', path: url.pathname })
    if (url.pathname === '/api/reminders' || url.pathname === '/api/reminders/') {
      return response({ success: true, data: { items: listItems, total: listItems.length, limit: 20 } })
    }
    if (url.pathname === '/api/folders') return response({ success: true, data: [], unfiledCount: 0 })
    if (url.pathname === '/api/list-stats') return response({ success: false, error: 'not needed' })
    if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: 'owner' } })
    return response({ success: true, data: {} })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  clearToastsForTest()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    }
  }
}

function renderPage() {
  act(() => {
    root.render(<><RemindersPage /><ToastHost /></>)
  })
}

test('再開は押した瞬間に有効の札になり、元に戻すで送らずに戻る', async () => {
  renderPage()
  await eventually(() => {
    if (!host.textContent?.includes('止まっている方')) throw new Error('no rows yet')
  })
  const checkbox = host.querySelector('[aria-label="止まっている方を選択"]') as HTMLElement
  expect(checkbox).toBeTruthy()
  await act(async () => { checkbox.click() })
  const resume = [...host.querySelectorAll('button')].find((b) => b.textContent === '再開') as HTMLElement
  expect(resume).toBeTruthy()
  await act(async () => { resume.click() })
  await eventually(() => {
    const pills = [...host.querySelectorAll('span')].filter((s) => s.textContent === '有効')
    if (pills.length < 2) throw new Error('not yet optimistic')
  })
  const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === '元に戻す') as HTMLElement
  expect(undo).toBeTruthy()
  await act(async () => { undo.click() })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(calls.some((c) => c.path.startsWith('/api/reminders/') && c.method !== 'GET')).toBe(false)
  await eventually(() => {
    const stopped = [...host.querySelectorAll('span')].filter((s) => s.textContent === '停止中')
    if (stopped.length < 1) throw new Error('not yet reverted')
  })
})

test('読み込み中は出来上がりと同じ形の骨組みを出す', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    calls.push({ method: init?.method ?? 'GET', path: url.pathname })
    if (url.pathname === '/api/reminders' || url.pathname === '/api/reminders/') {
      return new Promise(() => undefined) as unknown as Response
    }
    if (url.pathname === '/api/folders') return response({ success: true, data: [], unfiledCount: 0 })
    return response({ success: false, error: 'not needed' })
  }))
  renderPage()
  await eventually(() => {
    const busy = host.querySelector('[aria-busy="true"]')
    if (!busy) throw new Error('no busy container yet')
    if (!busy.querySelector('[data-skeleton]')) throw new Error('no skeleton yet')
  }, 8000)
})
