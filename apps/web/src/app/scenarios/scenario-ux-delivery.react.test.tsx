// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import ScenariosPage from './page'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/scenarios',
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

function item(id: string, name: string, isActive: boolean) {
  return {
    id, name, isActive, folderId: null, deliveryMode: 'elapsed',
    stepCount: 2, subscriberCount: 10, completedCount: 3,
    description: '', lineAccountId: 'account-a',
  }
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  calls.length = 0
  listItems = [item('s1', '止まっている方', false), item('s2', '動いている方', true)]
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    calls.push({ method: init?.method ?? 'GET', path: url.pathname })
    if (url.pathname === '/api/scenarios' || url.pathname === '/api/scenarios/') {
      return response({ success: true, data: { items: listItems, total: listItems.length, limit: 20, sort: [] } })
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

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

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
    root.render(<><ScenariosPage /><ToastHost /></>)
  })
}

test('再開は押した瞬間に稼働中になり、元に戻すで送らずに戻る', async () => {
  renderPage()
  await eventually(() => {
    if (!host.textContent?.includes('止まっている方')) throw new Error('no rows yet')
  })
  // 止まっている行を選ぶ。
  const checkbox = host.querySelector('[aria-label="止まっている方を選択"]') as HTMLElement
  expect(checkbox).toBeTruthy()
  await act(async () => { checkbox.click() })
  const resume = [...host.querySelectorAll('button')].find((b) => b.textContent === '再開') as HTMLElement
  expect(resume).toBeTruthy()
  await act(async () => { resume.click() })
  // 押した瞬間に稼働中の札へ（裏の保存を待たない）。
  await eventually(() => {
    const pills = [...host.querySelectorAll('span')].filter((s) => s.textContent === '稼働中')
    if (pills.length < 2) throw new Error('not yet optimistic')
  })
  // 知らせの「元に戻す」で送らずに戻せる。
  const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === '元に戻す') as HTMLElement
  expect(undo).toBeTruthy()
  await act(async () => { undo.click() })
  await settle()
  expect(calls.some((c) => c.path.startsWith('/api/scenarios/') && c.method !== 'GET')).toBe(false)
  await eventually(() => {
    const stopped = [...host.querySelectorAll('span')].filter((s) => s.textContent === '停止中')
    if (stopped.length < 1) throw new Error('not yet reverted')
  })
})

test('読み込み中は出来上がりと同じ形の骨組みを出す', async () => {
  // 一覧を止めて読み込み中のままにする。
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    calls.push({ method: init?.method ?? 'GET', path: url.pathname })
    if (url.pathname === '/api/scenarios' || url.pathname === '/api/scenarios/') {
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
