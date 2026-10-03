// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import FriendAddSettingsPage from './page'

/*
 * V8「サクサク感」C①②・D・E：友だち追加時の配信の一覧の行パネル。
 * 行を押すと右に詳細パネル（↑↓で次の行・受け皿も含む）。
 * 「編集する」は編集画面へつながる移り変わりで進む。
 * 名前のその場の書き換えは無し（名前を変える口が無いため）。
 */

const pushes: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push(url: string) { pushes.push(url) }, replace() {}, prefetch() {} }),
  usePathname: () => '/friend-add-settings',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false,
}) }))

let staffRole = 'admin'
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>()
  return { ...original, useStaffRole: () => staffRole }
})

let root: Root
let host: HTMLDivElement
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})

const baseRule = {
  id: 'rule-shop',
  accountId: 'account-a',
  friendKind: 'first_time',
  name: '店頭QRの初回案内',
  folderName: '店頭',
  priority: 1,
  isFallback: false,
  status: 'published',
  versionId: 'rule-shop-v1',
  versionNumber: 1,
  versionStatus: 'published',
  version: 1,
  lastTestStatus: 'succeeded',
  lastTestedAt: null,
  publishedAt: null,
  matchedLast7Days: 41,
  definition: {
    routeIds: ['route-shop'],
    scenarioId: 'scenario-welcome',
    messageType: 'text',
    messageText: '来店クーポンをご案内します。',
    timing: 'immediate',
    actions: [{ type: 'add_tag', label: 'タグ「新規友だち」を付ける', targetId: 'tag-new' }],
    friendCondition: null,
    activeFrom: null,
    activeUntil: null,
    weekdays: [1, 2, 3, 4, 5, 6, 0],
    timeWindows: [],
    resendSuppressionHours: 24,
    deliveryChoices: { sendWelcomeMessage: true, startScenario: true, runActions: true },
    unknownRouteAction: { sendCommonGuidance: true, notifyStaff: false },
  },
  routeNames: ['店頭QRコード'],
  scenarioName: '新規登録7日間フォロー',
}

const fallbackRule = {
  ...baseRule,
  id: 'rule-fallback',
  name: '経路が分からなかった人',
  folderName: null,
  priority: 999999,
  isFallback: true,
  matchedLast7Days: 12,
  routeNames: [],
}

const listData = {
  items: [baseRule, fallbackRule],
  total: 2,
  nextCursor: null,
  folderCounts: [{ name: '店頭', count: 1 }, { name: null, count: 1 }],
  summary: { rules: 2, active: 1, recentAdds: 86, captured: 74, unknownRoute: 12, delivered: 84, failed: 2 },
  options: {
    routes: [{ id: 'route-shop', name: '店頭QRコード', kind: 'QR' }],
    scenarios: [{ id: 'scenario-welcome', name: '新規登録7日間フォロー' }],
    tags: [{ id: 'tag-new', name: '新規友だち' }],
    folders: [{ id: 'f-1', name: '店頭' }],
  },
}

function handler(url: URL) {
  if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: staffRole } })
  if (url.pathname === '/api/friend-add-rules') return response({ success: true, data: listData })
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
  staffRole = 'admin'
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
  await act(async () => { root.render(<FriendAddSettingsPage />) })
  await eventually(() => {
    if (!host.textContent?.includes('店頭QRの初回案内')) throw new Error('row not loaded')
  })
  const firstRow = host.querySelector('tbody tr')
  if (!firstRow) throw new Error('no rows')
  await act(async () => {
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle()
}

test('行を押すと詳細パネルが開き、次の行（受け皿）へ移れる', async () => {
  await openFirstRow()
  await eventually(() => {
    const panel = document.body.querySelector('[data-design-part="detail-panel"]')
    if (!panel || !panel.textContent?.includes('店頭QRの初回案内')) throw new Error('panel not open')
  })
  const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
  await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await eventually(() => {
    const panel = document.body.querySelector('[data-design-part="detail-panel"]')
    if (!panel?.textContent?.includes('経路が分からなかった人')) throw new Error('did not move')
  })
})

test('パネルの「編集する」は編集画面へ進む', async () => {
  await openFirstRow()
  await eventually(() => {
    if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
  })
  const edit = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '編集する')
  if (!edit) throw new Error('no edit button')
  await act(async () => { edit.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(pushes).toEqual(['/friend-add-settings?view=edit&id=rule-shop'])
})
