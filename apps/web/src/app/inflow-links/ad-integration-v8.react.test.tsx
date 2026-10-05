// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import InflowLinksPage from './page'

/*
 * ★V8-B 広告連携（`qSTVR`）・広告とのつなぎ（`FDBsG`）・
 * 広告への送信履歴（`p0kA3`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい画面に切り替わることを
 * 実DOMで固定する。v7 では従来のタブが出ることも固定する。
 */
let search = 'tab=ads'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/inflow-links',
  useSearchParams: () => new URLSearchParams(search),
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
const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

function handler(url: URL) {
  if (url.pathname === '/api/ad-platforms') {
    return response({
      success: true,
      data: [
        { id: 'p-google', name: 'google', displayName: 'Google広告', isActive: true, config: {} },
        { id: 'p-meta', name: 'meta', displayName: 'Meta広告', isActive: true, config: {} },
      ],
    })
  }
  if (url.pathname === '/api/ad-platforms/logs') {
    return response({
      success: true,
      data: {
        items: [
          {
            id: 'log-1',
            adPlatformId: 'p-google',
            friendId: 'f-1',
            lineAccountId: 'account-a',
            eventName: '初回購入',
            clickId: 'abc',
            clickIdType: 'gclid',
            status: 'failed',
            errorMessage: '目印の期限が切れていました',
            createdAt: '2026-09-29T12:11:00+09:00',
          },
          {
            id: 'log-2',
            adPlatformId: 'p-meta',
            friendId: 'f-2',
            lineAccountId: 'account-a',
            eventName: '定期便の申し込み',
            clickId: 'def',
            clickIdType: 'fbclid',
            status: 'pending',
            errorMessage: null,
            createdAt: '2026-10-01T18:02:00+09:00',
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
        summary: { sentLast30Days: 15, pendingLast30Days: 2, failedLast30Days: 1 },
      },
    })
  }
  if (url.pathname === '/api/ad-costs') {
    return response({
      success: true,
      data: {
        rows: [
          {
            sourceLabel: 'Google広告 夏キャンペーン',
            adPlatformId: 'p-google',
            entryRouteId: 'er-ad-summer',
            source: 'import',
            totals: [{ currency: 'JPY', amountMinor: 52000 }],
            friendAdds: 42,
            costPerFriendMinor: 1238,
            lastImportedAt: '2026-10-01T06:00:00+09:00',
          },
        ],
        platforms: [
          {
            id: 'p-google',
            name: 'google',
            displayName: 'Google広告',
            lastSuccessAt: '2026-10-01T06:00:00+09:00',
            lastRunStatus: 'success',
            lastRunAt: '2026-10-01T06:00:00+09:00',
            lastError: null,
          },
        ],
        manualEntries: [],
      },
    })
  }
  if (url.pathname === '/api/entry-routes') {
    return response({
      success: true,
      data: [{ id: 'er-ad-summer', name: 'Google広告 夏キャンペーン', refCode: 'ad-summer' }],
    })
  }
  if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: 'admin' } })
  return response({ success: false, error: 'not mocked', data: null })
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
  staffRole = 'admin'
  search = 'tab=ads'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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

test('v8 の広告連携タブでは Pencil qSTVR に切り替わる', async () => {
  search = 'tab=ads'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<InflowLinksPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="qSTVR"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('広告連携')
  expect(host.textContent).toContain('この30日の広告費')
  expect(host.textContent).toContain('つないでいる')
  expect(host.textContent).toContain('流入元ごとの費用')
  expect(host.textContent).toContain('Google広告 夏キャンペーン')
  expect(host.textContent).toContain('費用を手で入れる')
})

test('v8 のつなぎタブでは Pencil FDBsG に切り替わる', async () => {
  search = 'tab=connections'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<InflowLinksPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="FDBsG"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('広告とのつなぎ')
  expect(host.textContent).toContain('返ししくみ')
  expect(host.textContent).toContain('送った件数')
  expect(host.textContent).toContain('送信履歴を見る')
})

test('v8 の送信履歴では Pencil p0kA3 に切り替わる', async () => {
  search = 'tab=connections&view=history'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<InflowLinksPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="p0kA3"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('広告への送信履歴')
  expect(host.textContent).toContain('CSVで書き出す')
  expect(host.textContent).toContain('初回購入')
  expect(host.textContent).toContain('断られました')
  expect(host.textContent).toContain('全 2 件')
  const retryButton = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('やり直す'),
  )
  expect(retryButton).toBeTruthy()
  await act(async () => {
    retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
  await eventually(() => {
    expect(host.textContent).toContain('目印の期限が切れていました')
  })
})
