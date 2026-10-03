// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import InflowLinksPage from '@/app/inflow-links/page'

/*
 * ★V8-B サイトスクリプト（板 `XjOte`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい画面に切り替わることを
 * 実DOMで固定する。v7 では従来のタブが出ることも固定する。
 */
let search = 'tab=script'
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
  if (url.pathname === '/api/settings/features/visibility') {
    return response({ success: true, data: { features: { site_tracking: true } } })
  }
  if (url.pathname === '/api/site/pages') {
    return response({
      success: true,
      data: [{ host: 'nen.example', path: '/', views: 4120, visitors: 38 }],
    })
  }
  if (url.pathname === '/api/site/summary') {
    return response({
      success: true,
      data: {
        todayEvents: 5,
        todayPageViews: 100,
        linkedEvents: 3,
        unlinkedEvents: 1,
        pathCount: 4,
        eventTypeCount: 2,
        lastEventAt: new Date().toISOString(),
      },
    })
  }
  if (url.pathname === '/api/measurement-sites') {
    return response({
      success: true,
      data: [
        {
          id: 'site-1',
          label: '然 公式サイト',
          domains: ['nen.example'],
          createdAt: '2026-09-01T00:00:00+09:00',
          rejectedCount: 0,
          lastRejectedHost: null,
          lastRejectedAt: null,
          stoppedAt: null,
          stoppedReason: null,
        },
      ],
    })
  }
  if (url.pathname === '/api/site/tracking-key') {
    return response({ success: true, data: { trackingKey: 'test-key-123' } })
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
  search = 'tab=script'
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

test('v8 のサイトスクリプトでは Pencil XjOte に切り替わる', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<InflowLinksPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="XjOte"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('サイトスクリプト')
  expect(host.textContent).toContain('貼りかたが分からないときは')
  expect(host.textContent).toContain('成果を数えるサイト')
  expect(host.textContent).toContain('然 公式サイト')
  expect(host.textContent).toContain('サイトに貼るコード')
  expect(host.textContent).toContain('コードをコピー')
  expect(host.textContent).toContain('制作会社へ送る文をコピー')
  expect(host.textContent).toContain('計測を許可するドメイン')
  expect(host.textContent).toContain('いま届いているか')
  expect(host.textContent).toContain('どうやって友だちと結びつくか')
  expect(host.textContent).toContain('つながる先')
})

test('v7 のサイトスクリプトでは従来の画面が出る', async () => {
  await act(async () => root.render(<InflowLinksPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="IhSBB"]')).toBeTruthy()
  })
  expect(host.querySelector('[data-design-node="XjOte"]')).toBeNull()
})
