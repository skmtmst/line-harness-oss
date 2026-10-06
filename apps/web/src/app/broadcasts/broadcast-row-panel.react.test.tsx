// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import BroadcastsPage from './list-v8'

/*
 * V8「サクサク感」C①・D・E：一斉配信一覧の行パネル。
 * 行を押すと右に詳細パネル（↑↓で次の行）。「開く」は詳細へつながる移り変わりで進む。
 */

const pushes: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push(url: string) { pushes.push(url) }, replace() {}, prefetch() {} }),
  usePathname: () => '/broadcasts',
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
const broadcast = (id: string, title: string) => ({
  id, title, status: 'scheduled', displayStatus: 'scheduled', approvalStatus: null,
  messageType: 'text', messageContent: 'セールのお知らせ',
  lineAccountId: 'account-a', accountIds: null, targetType: 'all',
  segmentConditions: null, folderId: null, scheduledAt: '2026-10-10 09:00:00',
  sentAt: null, successCount: 0, failureCount: 0, dedupPriority: null,
  failedAccountIds: null, trackLinks: false, messageBubbles: null,
  insightSummary: null, measureOpens: false, internalMemo: null,
  createdAt: '2026-09-01 00:00:00', updatedAt: '2026-09-01 00:00:00',
})
const seen: string[] = []
function handler(url: URL, init?: RequestInit) {
  seen.push(`${init?.method ?? 'GET'} ${url.pathname}`)
  if (url.pathname === '/api/broadcasts') {
    return response({
      success: true,
      data: [broadcast('b1', '一つ目'), broadcast('b2', '二つ目')],
      kpis: null, statusCounts: null, pagination: { total: 2 },
    })
  }
  if (url.pathname === '/api/tags') return response({ success: true, data: [] })
  if (url.pathname === '/api/scenarios') {
    return response({ success: true, data: { items: [], total: 0, limit: 200, sort: [] } })
  }
  if (url.pathname === '/api/folders') return response({ success: true, data: [], unfiledCount: 0 })
  if (url.pathname === '/api/broadcasts/saved-views') return response({ success: true, data: [] })
  if (url.pathname === '/api/dashboard/overview') return response({ success: false, error: 'not needed' })
  if (url.pathname === '/api/staff/me') return response({ success: false, error: 'not needed' })
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
  vi.stubGlobal('fetch', (input: URL | RequestInfo, init?: RequestInit) =>
    Promise.resolve(handler(new URL(String(input)), init)))
})
afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

async function openFirstRow() {
  await act(async () => { root.render(<BroadcastsPage />) })
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

test('パネルの「開く」は詳細へ進む', async () => {
  await openFirstRow()
  await eventually(() => {
    if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
  })
  const open = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '開く')
  if (!open) throw new Error('no open button')
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(pushes).toEqual(['/broadcasts/detail?id=b1'])
})
