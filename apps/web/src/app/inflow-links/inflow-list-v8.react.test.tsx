// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import InflowLinksPage from './page'
import { clearFeatureVisibilityCache } from '@/lib/feature-visibility-cache'

/*
 * ★V8-B 流入と計測の一覧（Pencil `xbHxg`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい一覧に切り替わり、
 * 見本が決めた見出し・数の帯・フォルダの列・表の列が出ることを
 * 実DOMで固定する。v7 では従来の一覧が出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/inflow-links',
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
let handler: (url: URL, init?: { method?: string; body?: string }) => Promise<Response> | Response
const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

const route = {
  id: 'er-summer-ig',
  refCode: 'summer-ig',
  genre: 'SNS',
  name: '夏のInstagram投稿',
  poolId: null,
  tagId: 'tag-instagram',
  scenarioId: 'sc-summer',
  runAccountFriendAddScenarios: true,
  isActive: true,
}

const summary = {
  routes: [
    {
      refCode: 'summer-ig',
      name: null,
      friendCount: 31,
      clickCount: 880,
      latestAt: '2026-09-30T09:40:00+09:00',
    },
  ],
  totalFriends: 31,
  friendsWithRef: 31,
  friendsWithoutRef: 0,
}

function base(url: URL) {
  if (url.pathname === '/api/settings/features/visibility') return response({ success: true, data: { features: { site_tracking: true } } })
  if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: staffRole } })
  if (url.pathname === '/api/entry-routes') return response({ success: true, data: [route] })
  if (url.pathname === '/api/entry-route-genres') {
    return response({ success: true, data: [{ id: 'g-sns', name: 'SNS', createdAt: '', updatedAt: '' }] })
  }
  if (url.pathname === '/api/analytics/ref-summary') return response({ success: true, data: summary })
  if (url.pathname === '/api/tracked-links') return response({ success: true, data: [] })
  if (url.pathname === '/api/ad-platforms') {
    return response({
      success: true,
      data: [{ id: 'p-google', name: 'google', displayName: 'Google広告', isActive: true }],
    })
  }
  if (url.pathname === '/api/scenarios') {
    return response({
      success: true,
      data: { items: [{ id: 'sc-summer', name: '夏の案内' }], total: 1, limit: 200, sort: [] },
    })
  }
  if (url.pathname === '/api/tags') {
    return response({ success: true, data: [{ id: 'tag-instagram', name: 'Instagram', color: '#06c755' }] })
  }
  if (url.pathname === '/api/message-templates') return response({ success: true, data: [] })
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
  clearFeatureVisibilityCache()
  handler = base
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

test('v8 の下では Pencil xbHxg の新しい一覧に切り替わる', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<InflowLinksPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="xbHxg"]')).toBeTruthy()
  })
  // 見出しと右のボタン
  expect(host.textContent).toContain('流入と計測')
  expect(host.textContent).toContain('広告とのつなぎ')
  expect(host.textContent).toContain('サイトスクリプト')
  // 数の帯の4マス
  expect(host.textContent).toContain('友だち追加')
  expect(host.textContent).toContain('動きが未設定')
  expect(host.textContent).toContain('広告とつないだ')
  // フォルダの列
  expect(host.textContent).toContain('フォルダを追加')
  // 行の中身（名前・追加先・友だちになったら・数）
  expect(host.textContent).toContain('夏のInstagram投稿')
  expect(host.textContent).toContain('計測済')
  expect(host.textContent).toContain('31人')
})

test('v8 の閲覧のみでは帯が出て作る操作が押せない形になる', async () => {
  staffRole = 'viewer'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<InflowLinksPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="xbHxg"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('閲覧のみで見ています')
  expect(host.querySelector('a[href="/inflow-links/new"]')).toBeNull()
})
