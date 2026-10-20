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
 * ★V8-B 外部連携のやり取りの記録（板 ・中身 ）の契約。
 * `<html data-theme="v8">` の下でだけ新しい記録タブに切り替わり、
 * 見本が決めた帯・札・表が出ることを実DOMで固定する。
 * 互換経路では従来の記録タブが出ることも固定する。
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

let staffIdentity: { role: string; readOnly?: boolean; roleBundle?: string }
let mutationRequests = 0

beforeEach(() => {
  staffIdentity = { role: 'owner' }
  mutationRequests = 0
  items = [interaction()]
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method && !['GET', 'HEAD'].includes(init.method)) mutationRequests++
    const url = String(input)
    if (url.includes('/api/staff/me') || url.includes('/staff/me')) {
      return json({ success: true, data: staffIdentity })
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
  const details = [...(board?.querySelectorAll('[title]') ?? [])].map(node => node.getAttribute('title'))
  expect(details.some(title => title?.includes('この30日で 99.9%成功。平均 0.4 秒'))).toBe(true)
  expect(details.some(title => title?.includes('この30日でいちばん遅くて 1.2秒'))).toBe(true)
  expect(details.some(title => title?.includes('うち2件はここから送り直せます'))).toBe(true)
  // 表の行：返事の札・かかった時間・行の右端の「…」（中身を見るはその中）。
  expect(board?.textContent).toContain('500 エラー')
  expect(board?.querySelector('button[aria-label="「予約台帳」の操作"]')).not.toBeNull()
})

/** 行の「…」を開いて「中身を見る」を押す（行の右端は「…」だけ）。 */
async function openContents(board: Element, name?: string) {
  const trigger = (name
    ? board.querySelector(`button[aria-label="「${name}」の操作"]`)
    : board.querySelector('button[aria-label$="の操作"]')) as HTMLElement
  await act(async () => { trigger.click() })
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent?.includes('中身を見る')) as HTMLElement
  expect(item).toBeTruthy()
  await act(async () => { item.click() })
}

test('v8 で失敗したものをまとめてやり直すボタンが出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="Uv9AA"]')
  expect(board?.textContent).toContain('失敗したものをまとめてやり直す')
})

test('旧テーマ属性でも現役の記録タブが出て Uv9AA が出る', async () => {
  await renderPage()
  expect(host.querySelector('[data-design-node="Uv9AA"]')).not.toBeNull()
  expect(host.querySelector('[data-design-node="KNG00"]')).toBeNull()
})

/*
 * 中身は絵  どおり真ん中の窓（2026-10-07 右の詳細パネルから変えた）。
 * 絵の窓に前後の行へ移る操作は無いので、前後送りの確かめは外した（BEHAVIOR.md）。
 */
test('v8 で中身を見ると中身の窓（DA0Ag）が出て、伏せ字の本文と送り直しが出る', async () => {
  items = [
    interaction(),
    interaction({ id: 'whk_20260930_0601_01', webhookName: '顧客台帳', triggerSummary: '友だちが追加された' }),
  ]
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="Uv9AA"]')!
  const dialogOf = () => document.querySelector('[data-design-node="DA0Ag"]')
  // まだ閉じているときは窓は無い。
  expect(dialogOf()).toBeNull()
  await openContents(board, '予約台帳')
  await act(async () => {})
  const dialog = dialogOf() as HTMLElement
  expect(dialog).not.toBeNull()
  expect(dialog.textContent).toContain('やり取りの中身')
  expect(dialog.textContent).toContain('予約台帳')
  expect(dialog.textContent).toContain('相手先のサーバが応えませんでした')
  // 本文は F-18 の口から読む（伏せ字のまま出す）。
  expect(dialog.textContent).toContain('"friend": "Masato S.（伏せ字）"')
  expect(dialog.textContent).toContain('届いたか確かめてから送り直す')
  // 一覧は後ろに残る。
  expect(board.querySelector('tbody tr')).not.toBeNull()
})

test('v8 の中身の窓は閉じるで閉じて一覧だけに戻る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="Uv9AA"]')!
  const dialogOf = () => document.querySelector('[data-design-node="DA0Ag"]')
  await openContents(board)
  expect(dialogOf()).not.toBeNull()
  const close = [...(dialogOf() as HTMLElement).querySelectorAll('button')].find((button) => button.textContent === '閉じる') as HTMLElement
  await act(async () => { close.click() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) })
  expect(dialogOf()).toBeNull()
  expect(board.querySelector('tbody tr')).not.toBeNull()
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

test.each([
  { role: 'staff' }, { role: 'viewer' }, { role: 'admin', readOnly: true }, { role: 'owner', roleBundle: 'view_only' },
])('変更できない担当者は記録と中身を読めるが単体・一括の送り直しはない: %j', async identity => {
  staffIdentity = identity
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="Uv9AA"]')!
  expect(board.textContent).toContain('500 エラー')
  expect([...board.querySelectorAll('button')].some(button => button.textContent?.includes('失敗したものをまとめてやり直す'))).toBe(false)
  await openContents(board)
  expect([...document.querySelectorAll('button')].filter(button => button.textContent?.includes('送り直す'))).toHaveLength(0)
  expect(mutationRequests).toBe(0)
})
