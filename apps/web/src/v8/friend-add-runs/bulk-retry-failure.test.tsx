// @vitest-environment happy-dom
// @vitest-environment happy-dom
/*
 * V8 友だち追加時の配信の実行結果（src/v8・）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 結果・行ったことの言葉／札で絞ると URL が変わる／失敗の帯で今のページの失敗を順にもう一度実行する／
 * 閲覧のみには変える操作を出さない／顧客名が隠された記録はトークへ進ませない。
 */
const blocked: string[] = [];
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/friend-add-settings/runs',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

const roleState = vi.hoisted(() => ({ role: 'owner' as string }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => roleState.role }
})

import FriendAddRunsV8, { actionText, resultView } from '@/v8/friend-add-runs/runs'
import type { FriendAddRunList } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type RunItem = FriendAddRunList['items'][number]

function run(overrides: Partial<RunItem> = {}): RunItem {
  return {
    id: 'run-ok', receivedAt: '2026-09-07T01:32:00.000Z', processedAt: '2026-09-07T01:32:00.800Z',
    friend: { id: 'friend-1', displayName: '合成A', redacted: false }, friendKind: 'first_time',
    attribution: { status: 'captured', routeId: 'route-shop', routeName: '店頭QR', reason: null },
    rule: { id: 'rule-shop', name: '店頭QRの初回案内', versionId: 'v1', versionNumber: 1 },
    scenario: { id: 'scenario-1', name: '7日間フォロー', enrollmentId: 'en-1', started: true },
    actions: { total: 1, failed: 0 }, deliveryCount: 1, status: 'completed', errorCode: null,
    ...overrides,
  } as RunItem
}

const failedRun = (id: string, name: string) => run({
  id, friend: { id: `friend-${id}`, displayName: name, redacted: false },
  scenario: { id: 'scenario-1', name: '7日間フォロー', enrollmentId: null, started: false },
  status: 'failed', errorCode: 'action_failed', actions: { total: 2, failed: 1 },
})

let items: RunItem[] = []
let retried: string[] = []
let failRetries = true
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  roleState.role = 'owner'
  retried = []
  nav.replace.mockClear()
  items = [
    run(),
    failedRun('run-f1', '合成B'),
    failedRun('run-f2', '合成C'),
    run({ id: 'run-hidden', friend: { id: '', displayName: '顧客名は非表示', redacted: true } as RunItem['friend'] }),
  ]
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/client-errors' && init?.method === 'POST') return json({success:true,data:{}})
    if (url.pathname === '/api/staff/me') return json({ success: true, data: { role: roleState.role } })
    if (url.pathname === '/api/friend-add-runs') {
      return json({
        success: true,
        data: {
          items, total: items.length, nextCursor: null,
          summary: { recentFriends: 4, recentEvents: 4, cumulativeDeliveries: 10, scenarioStarts: 1, averageSendTimeMs: 600, failed: 2, totalRuns: 4, lastDeliveryAt: null },
        },
      })
    }
    const retry = url.pathname.match(/^\/api\/friend-add-runs\/([^/]+)\/retry$/)
    if (retry && init?.method === 'POST') {
      retried.push(decodeURIComponent(retry[1]))
      if (failRetries) return new Response(JSON.stringify({success:false,error:'synthetic ordinary failure'}),{status:500})
      return json({ success: true, data: { status: 'completed', retried: 1 } })
    }
    if (url.pathname.startsWith('/api/friend-add-rules/')) {
      return json({ success: true, data: { rule: { status: 'published', version: 3, definition: { resendSuppressionHours: 24 } } } })
    }
    blocked.push(url.pathname);throw new Error('UNMOCKED_API:'+url.pathname)
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

async function render() {
  await act(async () => {
    root.render(<FriendAddRunsV8 />)
  })
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

const buttons = () => Array.from(host.querySelectorAll('button'))
const buttonByText = (text: string) => buttons().find((button) => button.textContent?.includes(text))


describe('OPS-C02 synthetic retry failures',()=>{
 it('all ordinary failures are presented as no retryable work',async()=>{
 failRetries=true;await render();
 await act(async()=>{buttonByText('失敗した処理をもう一度')?.click()});
 for(let i=0;i<6;i++) await act(async()=>{await new Promise(r=>setTimeout(r,0))});
 expect(retried).toEqual(['run-f1','run-f2']);
 expect(host.textContent).toContain('2 件をもう一度実行できませんでした');expect(host.textContent).not.toContain('もう一度実行できる処理はありませんでした。');
 });
 it('success control displays actual completed count',async()=>{
 failRetries=false;await render();
 await act(async()=>{buttonByText('失敗した処理をもう一度')?.click()});
 for(let i=0;i<6;i++) await act(async()=>{await new Promise(r=>setTimeout(r,0))});
 expect(retried).toEqual(['run-f1','run-f2']);
 expect(host.textContent).toContain('失敗した処理を2 件もう一度実行しました。');
 });
});
