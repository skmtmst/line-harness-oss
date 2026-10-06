// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import WebhooksPage from './page'

/*
 * ★V8-B 外部連携の Google Sheets（板 `DxAAA`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい Sheets タブに切り替わり、
 * 見本が決めた書き出しカード・記録の表が出ることを実DOMで固定する。
 * v7 では従来の Sheets タブが出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webhooks',
  useSearchParams: () => new URLSearchParams([['tab', 'sheets']]),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a',
  selectedAccount: { name: 'NEN-TEST' },
  accounts: [],
  loading: false,
}) }))

let root: Root
let host: HTMLDivElement

const connection = {
  status: 'connected',
  googleAccountEmail: 'k***@gmail.com',
  spreadsheetId: 'sheet-1',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1',
  spreadsheetTitle: 'musubo 友だち台帳',
  lastSyncedAt: '2026-09-30T03:00:00.000Z',
  lastSyncStatus: 'ok',
  lastSyncError: null,
}

const runs = [
  {
    id: 'run-1', startedAt: '2026-09-30T03:00:00.000Z', kind: 'scheduled',
    dataType: 'friends', rowsWritten: 1284, status: 'ok', error: null, spreadsheetId: 'sheet-1',
  },
  {
    id: 'run-2', startedAt: '2026-09-30T03:00:00.000Z', kind: 'scheduled',
    dataType: 'form_answers', rowsWritten: 312, status: 'ok', error: null, spreadsheetId: 'sheet-1',
  },
]

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
    if (url.includes('/api/webhooks/outgoing')) return json({ success: true, data: [] })
    if (url.includes('/incoming')) return json({ success: true, data: [] })
    if (url.includes('/interactions')) {
      return json({ success: true, data: { summary: {
        total: 0, outgoing: 0, incoming: 0, succeeded: 0,
        failed: 0, resultUnknown: 0, outgoingFailed: 0, retryable: 0, averageDurationMs: null,
      } } })
    }
    if (url.includes('google-sheets/runs')) {
      return json({ success: true, data: { runs } })
    }
    if (url.includes('google-sheets')) {
      return json({ success: true, data: { connection, canManage: true, oauthConfigured: true, syncRunning: false } })
    }
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

test('v8 では DxAAA の書き出しカードと記録の表が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="DxAAA"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('Google Sheets への書き出し')
  expect(board?.textContent).toContain('接続しています')
  expect(board?.textContent).toContain('今すぐ同期')
  expect(board?.textContent).toContain('同期の記録')
  expect(board?.textContent).toContain('完了')
})

test('v7 では従来の Sheets タブが出て DxAAA は出ない', async () => {
  await renderPage()
  expect(host.querySelector('[data-design-node="DxAAA"]')).toBeNull()
})

test('v8 の読み込み中は連携の形の骨組みが出て「読み込み中」の文字は無い', async () => {
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
    const board = host.querySelector('[data-design-node="DxAAA"]')
    expect(board?.querySelector('[aria-label="連携の状態を読み込んでいます"]')).not.toBeNull()
    expect(board?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
    expect(board?.textContent).not.toContain('読み込み中')
  } finally {
    vi.useRealTimers()
  }
})
