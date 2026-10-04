// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import WebhooksPage from './page'
import type { WebhookInteraction } from '@line-crm/shared'

/*
 * ★V8-B 外部連携のやり取りの記録（板 `Uv9AA`・中身 `DA0Ag`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい記録タブに切り替わり、
 * 見本が決めた帯・札・表が出ることを実DOMで固定する。
 * v7 では従来の記録タブが出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webhooks',
  useSearchParams: () => new URLSearchParams([['tab', 'interactions']]),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false,
}) }))

let root: Root
let host: HTMLDivElement

function interaction(overrides: Partial<WebhookInteraction> = {}): WebhookInteraction {
  return {
    id: 'whk_20260930_0558_02',
    direction: 'outgoing',
    webhookName: '予約台帳',
    eventType: 'booking_created',
    triggerSummary: '予約が入った',
    status: 'failed',
    responseLabel: '500 エラー',
    responseStatus: 500,
    attemptCount: 3,
    durationMs: 1200,
    failureReason: '相手先のサーバが応えませんでした。3回まで自動でやり直し、すべて失敗しました。',
    failureReasonCode: 'response_5xx',
    canRetry: true,
    retryBlockReason: null,
    autoRetryNextAt: null,
    startedAt: '2026-09-30T05:58:00.000Z',
    completedAt: '2026-09-30T05:58:01.000Z',
    retryOfId: null,
    ...overrides,
  }
}

let items: WebhookInteraction[] = [interaction()]

const json = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

const summary = {
  total: 2146, outgoing: 1734, incoming: 412, succeeded: 2144,
  failed: 2, resultUnknown: 0, outgoingFailed: 2, retryable: 2, averageDurationMs: 400,
}

beforeEach(() => {
  items = [interaction()]
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
      if (url.includes('/payload')) {
        return json({ success: true, data: { id: 'whk_20260930_0558_02', body: { event: 'booking_created', friend: 'Masato S.（伏せ字）' }, available: true } })
      }
      return json({ success: true, data: { items, total: items.length, page: 1, limit: 20, summary } })
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

test('v8 では Uv9AA の記録（帯・札・表）が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="Uv9AA"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('やり取りの記録')
  // 数の帯：同じ集計から出す（送った 1,734回・すべて 2,146回）。
  expect(board?.textContent).toContain('1,734')
  expect(board?.textContent).toContain('2,146')
  // 表の行：返事の札・かかった時間・操作。
  expect(board?.textContent).toContain('500 エラー')
  expect(board?.textContent).toContain('中身を見る')
})

test('v8 で失敗したものをまとめてやり直すボタンが出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="Uv9AA"]')
  expect(board?.textContent).toContain('失敗したものをまとめてやり直す')
})

test('v7 では従来の記録タブが出て Uv9AA は出ない', async () => {
  await renderPage()
  expect(host.querySelector('[data-design-node="Uv9AA"]')).toBeNull()
  expect(host.querySelector('[data-design-node="KNG00"]')).not.toBeNull()
})

test('v8 で中身を開くと伏せた本文の黒枠が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '中身を見る')
  expect(openButton).not.toBeUndefined()
  await act(async () => {
    if (openButton) fireEvent.click(openButton)
  })
  await act(async () => {})
  const detail = document.querySelector('[data-design-node="DA0Ag"]')
  expect(detail).not.toBeNull()
  expect(detail?.textContent).toContain('送った・届いた中身')
  expect(detail?.textContent).toContain('booking_created')
})

test('v8 の読み込み中は記録の表の形の骨組みが出て「読み込み中」の文字は無い', async () => {
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
    const board = host.querySelector('[data-design-node="Uv9AA"]')
    expect(board?.querySelector('[aria-label="やり取りの記録を読み込んでいます"]')).not.toBeNull()
    expect(board?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
    expect(board?.textContent).not.toContain('読み込み中')
  } finally {
    vi.useRealTimers()
  }
})
