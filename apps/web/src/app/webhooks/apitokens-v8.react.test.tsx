// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import WebhooksPage from './page'

/*
 * ★V8-B 外部連携の API 接続（板 `ralAc`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい鍵タブに切り替わり、
 * 見本が決めた表・札・操作が出ることを実DOMで固定する。
 * v7 では従来の鍵タブが出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webhooks',
  useSearchParams: () => new URLSearchParams([['tab', 'api-tokens']]),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false,
}) }))

let root: Root
let host: HTMLDivElement

const token = {
  id: 'tok-1',
  name: '予約システム連携',
  tokenPrefix: 'mhk_abc',
  scopes: ['tags:read', 'tags:write'],
  createdBy: null,
  lastUsedAt: '2026-09-30T10:02:00.000Z',
  rotatedFromId: null,
  createdAt: '2026-06-02T00:00:00.000Z',
  revokedAt: null,
}

const revokedToken = {
  id: 'tok-2',
  name: '旧ポイント連携',
  tokenPrefix: 'mhk_old',
  scopes: ['tags:write'],
  createdBy: null,
  lastUsedAt: '2025-08-31T12:00:00.000Z',
  rotatedFromId: null,
  createdAt: '2025-11-10T00:00:00.000Z',
  revokedAt: '2025-09-01T00:00:00.000Z',
}

const json = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/staff/me') || url.includes('/staff/me')) {
      return json({ success: true, data: { role: 'owner' } })
    }
    if (url.includes('/api/webhooks/outgoing')) return json({ success: true, data: [] })
    if (url.includes('/incoming')) return json({ success: true, data: [] })
    if (url.includes('/interactions')) {
      return json({ success: true, data: { summary: {
        total: 0, outgoing: 0, incoming: 0, succeeded: 0,
        failed: 0, resultUnknown: 0, outgoingFailed: 0, retryable: 0, averageDurationMs: null,
      } } })
    }
    if (url.includes('/reactivate')) return json({ success: true, data: { ...revokedToken, revokedAt: null } })
    if (url.includes('/api-tokens')) return json({ success: true, data: [token, revokedToken] })
    return json({ success: false, error: 'not found' }, 404)
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

async function renderPage() {
  await act(async () => {
    root.render(<WebhooksPage />)
  })
  await act(async () => {})
}

test('v8 では ralAc の鍵の表（札・入れ替える）が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="ralAc"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('予約システム連携')
  expect(board?.textContent).toContain('使っている')
  expect(board?.textContent).toContain('入れ替える')
  expect(board?.textContent).toContain('API接続の鍵を発行する')
})

test('v7 では従来の鍵タブが出て ralAc は出ない', async () => {
  await renderPage()
  expect(host.querySelector('[data-design-node="ralAc"]')).toBeNull()
})

test('v8 では止めた鍵に止めているの札と動かすが出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="ralAc"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('旧ポイント連携')
  expect(board?.textContent).toContain('止めている')
  expect(board?.textContent).toContain('動かす')
})

test('v8 の読み込み中は鍵の表の形の骨組みが出て「読み込み中」の文字は無い', async () => {
  document.documentElement.dataset.theme = 'v8'
  vi.useFakeTimers()
  try {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}))
    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    const board = host.querySelector('[data-design-node="ralAc"]')
    expect(board?.querySelector('[aria-label="鍵を読み込んでいます"]')).not.toBeNull()
    expect(board?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
    expect(board?.textContent).not.toContain('読み込み中')
  } finally {
    vi.useRealTimers()
  }
})
