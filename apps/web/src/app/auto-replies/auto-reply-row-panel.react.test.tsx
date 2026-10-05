// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import AutoRepliesPage from './list-v8'

/*
 * V8「サクサク感」C①・D・E：自動応答一覧の行パネル。
 * 行を押すと右に詳細パネル（↑↓で次の行）。「開く」は編集へつながる移り変わりで進む。
 */

const pushes: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push(url: string) { pushes.push(url) }, replace() {}, prefetch() {} }),
  usePathname: () => '/auto-replies',
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
const rule = (id: string, name: string) => ({
  id, name, keyword: 'こんにちは', matchType: 'exact', responseType: 'text',
  responseContent: 'いらっしゃいませ', templateId: null, lineAccountId: 'account-a',
  isActive: true, activeFrom: null, activeUntil: null, cooldownMinutes: null,
  skipWhenOperatorActive: false, priority: 1, messageKinds: null,
  receiveSources: ['line'], actions: null, responseWeekdays: null,
  responseHolidayRule: null, oncePerFriend: false, keywords: null,
  friendConditions: null, respondToAll: false, keywordMatchMode: 'or',
  folderId: null, internalMemo: null, lifecycleStatus: 'published',
  stoppedAt: null, stoppedByStaffId: null, stoppedByStaffName: null,
  stopReason: null, hits: { period: 4, total: 20 }, actionExecutionCount: null,
  conflictAttentionCount: null, createdAt: '2026-09-01',
})
function handler(url: URL) {
  if (url.pathname === '/api/auto-replies') {
    return response({ success: true, data: [rule('a1', '一つ目'), rule('a2', '二つ目')] })
  }
  if (url.pathname === '/api/templates') return response({ success: true, data: [] })
  if (url.pathname === '/api/folders') return response({ success: true, data: [], unfiledCount: 0 })
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
  vi.stubGlobal('fetch', (input: URL | RequestInfo) =>
    Promise.resolve(handler(new URL(String(input)))))
})
afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

async function openFirstRow() {
  await act(async () => { root.render(<AutoRepliesPage />) })
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

test('パネルの「開く」は編集へ進む', async () => {
  await openFirstRow()
  await eventually(() => {
    if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
  })
  const open = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '開く')
  if (!open) throw new Error('no open button')
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(pushes).toEqual(['/auto-replies/edit?id=a1'])
})
