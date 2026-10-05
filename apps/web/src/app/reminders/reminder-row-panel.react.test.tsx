// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import RemindersPage from './page'

/*
 * V8「サクサク感」C①・E：リマインダ一覧の行パネル。
 * 行を押すと右に詳細パネル（↑↓で次の行）。「詳細を見る」は詳細へ進む。
 */

const pushes: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push(url: string) { pushes.push(url) }, replace() {}, prefetch() {} }),
  usePathname: () => '/reminders',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false,
}) }))

let root: Root
let host: HTMLDivElement
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})
const reminder = (id: string, name: string) => ({
  id, name, description: null, isActive: true, lifecycleStatus: 'published',
  triggerType: 'friend_field', deliveryMode: 'time', triggerOffsetMinutes: 0,
  sendAtTime: '09:00', folderId: null, stepCount: 2,
  timingSummary: '基準日の 3日前 09:00', hasFailure: false,
  plannedDeliveries: 5, failedCount: 0, nextScheduledAt: '2026-10-10 09:00',
  displayOrder: 0, createdAt: '2026-09-01 00:00', updatedAt: '2026-09-02 00:00',
})
function handler(url: URL) {
  if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: 'admin' } })
  if (url.pathname === '/api/folders') return response({ success: true, data: [], unfiledCount: 0 })
  if (url.pathname === '/api/list-stats') {
    return response({
      success: true,
      data: {
        tags: {}, marks: {}, searches: {}, templates: {}, scenarios: {},
        reminders: { total: 2, active: 2, waiting: 0, sentThisMonth: 0, failed: 0 },
      },
    })
  }
  if (url.pathname === '/api/reminders') {
    return response({
      success: true,
      data: { items: [reminder('r1', '一つ目'), reminder('r2', '二つ目')], total: 2, limit: 20 },
    })
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
  pushes.length = 0
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', (input: URL | RequestInfo) =>
    Promise.resolve(handler(new URL(String(input)))))
})
afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

async function openFirstRow() {
  await act(async () => { root.render(<RemindersPage />) })
  await eventually(() => {
    if (!host.textContent?.includes('一つ目')) throw new Error('row not loaded')
  })
  const firstRow = host.querySelector('tbody tr')
  if (!firstRow) throw new Error('no rows')
  await act(async () => {
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle()
}

test('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
  await openFirstRow()
  await eventually(() => {
    const panel = document.body.querySelector('[data-design-part="detail-panel"]')
    if (!panel || !panel.textContent?.includes('一つ目')) throw new Error('panel not open')
  })
  const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
  await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await eventually(() => {
    const panel = document.body.querySelector('[data-design-part="detail-panel"]')
    if (!panel?.textContent?.includes('二つ目')) throw new Error('did not move')
  })
})

test('パネルの「詳細を見る」は詳細へ進む', async () => {
  await openFirstRow()
  await eventually(() => {
    if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
  })
  const open = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '詳細を見る')
  if (!open) throw new Error('no detail button')
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(pushes).toEqual(['/reminders/detail?id=r1'])
})
