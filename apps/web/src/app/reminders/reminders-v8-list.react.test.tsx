// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import RemindersPage from './page'

/*
 * ★V8 一覧（Pencil `apLqS`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい一覧に切り替わり、
 * 見本が決めた文言・帯・行の操作が出ることを実DOMで固定する。
 * v7（data-theme なし）では従来の一覧が出ることも一緒に固定する。
 */
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
let handler: (url: URL) => Promise<Response> | Response
const response = (data: unknown, status = 200, headers?: Record<string, string>) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json', ...(headers ?? {}) } },
)

const reminder = {
  id: 'r-1',
  name: '契約終了の前に知らせる',
  description: null,
  isActive: true,
  lifecycleStatus: 'published',
  triggerType: 'friend_field',
  deliveryMode: 'time',
  triggerOffsetMinutes: 0,
  sendAtTime: '09:00',
  folderId: null,
  stepCount: 2,
  timingSummary: '基準日の 3日前 09:00',
  hasFailure: false,
  plannedDeliveries: 5,
  failedCount: 0,
  nextScheduledAt: '2026-10-10 09:00',
  displayOrder: 0,
  createdAt: '2026-09-01 00:00',
  updatedAt: '2026-09-02 00:00',
}

function base(url: URL) {
  if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: 'admin' } })
  if (url.pathname === '/api/folders') return response({ success: true, data: [], unfiledCount: 0 })
  if (url.pathname === '/api/list-stats') {
    return response({
      success: true,
      data: {
        tags: {}, marks: {}, searches: {}, templates: {}, scenarios: {},
        reminders: { total: 3, active: 2, waiting: 8, sentThisMonth: 42, failed: 1 },
      },
    })
  }
  if (url.pathname === '/api/reminders') {
    return response({ success: true, data: { items: [reminder], total: 1, limit: 20 } })
  }
  return response({ success: true, data: {} })
}
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
beforeEach(() => {
  handler = base
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
    return handler(url)
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

test('v8 の下では Pencil apLqS の新しい一覧に切り替わる', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<RemindersPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="apLqS"]')).toBeTruthy()
  })
  // 見本が決めた帯と見出し
  expect(host.textContent).toContain('リマインダを作る')
  expect(host.textContent).toContain('有効')
  expect(host.textContent).toContain('これから送る')
  expect(host.textContent).toContain('今月送った')
  expect(host.textContent).toContain('送れなかった')
  expect(host.textContent).toContain('次に送る')
  expect(host.textContent).toContain('並び順')
  expect(host.textContent).toContain('20件表示')
  // KPI は API の実値
  expect(host.querySelector('[data-design="KPIs"]')?.textContent).toContain('2')
  expect(host.querySelector('[data-design="KPIs"]')?.textContent).toContain('8')
  expect(host.querySelector('[data-design="KPIs"]')?.textContent).toContain('42')
  expect(host.querySelector('[data-design="KPIs"]')?.textContent).toContain('1')
  // 行には名と副題、状態の札、予定・次回の実値
  expect(host.textContent).toContain('契約終了の前に知らせる')
  expect(host.textContent).toContain('基準日の 3日前 09:00')
  expect(host.textContent).toContain('5通')
  expect(host.textContent).toContain('10/10')
})

test('v8 の一覧で失敗のある行は「失敗 N」の札を出す', async () => {
  document.documentElement.dataset.theme = 'v8'
  handler = (url) => {
    if (url.pathname === '/api/reminders') {
      return response({
        success: true,
        data: { items: [{ ...reminder, hasFailure: true, failedCount: 2 }], total: 1, limit: 20 },
      })
    }
    return base(url)
  }
  await act(async () => root.render(<RemindersPage />))
  await settle()
  await eventually(() => {
    expect(host.textContent).toContain('失敗 2')
  })
})

test('v8 の行の操作は見本の並びを持つ', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<RemindersPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="apLqS"]')).toBeTruthy()
  })
  const trigger = [...host.querySelectorAll('button')]
    .find((item) => item.getAttribute('aria-label') === 'リマインダ「契約終了の前に知らせる」の操作')
  expect(trigger).toBeTruthy()
  await act(async () => { trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await eventually(() => {
    const menu = document.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()
    const labels = [...menu!.querySelectorAll('[role="menuitem"]')]
      .map((item) => item.textContent?.trim())
    expect(labels).toEqual([
      '開く', '登録者を管理', '配信予定を見る', '実行結果を見る',
      '編集', '複製する', '一時停止する', 'フォルダへ移す', '削除',
    ])
  })
})

test('v7 の下では従来の一覧が出る（新しい一覧には切り替わらない）', async () => {
  await act(async () => root.render(<RemindersPage />))
  await settle()
  await eventually(() => {
    expect(host.textContent).toContain('契約終了の前に知らせる')
  })
  expect(host.querySelector('[data-design-node="apLqS"]')).toBeNull()
})
