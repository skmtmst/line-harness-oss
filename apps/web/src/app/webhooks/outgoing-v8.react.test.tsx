// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import WebhooksPage from './page'
import type { OutgoingWebhookOverview } from '@/lib/api'

/*
 * ★V8-B 外部連携の一覧（板 `ZSbFY`・状態 `wWrpY`・閲覧のみ `l5SRfT`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい一覧に切り替わり、
 * 見本が決めた帯・表・札・押せない形が出ることを実DOMで固定する。
 * v7 では従来の一覧が出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webhooks',
  useSearchParams: () => new URLSearchParams([['tab', 'outgoing']]),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false,
}) }))

let staffRole = 'owner'
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>()
  return { ...original, useStaffRole: () => staffRole }
})

let root: Root
let host: HTMLDivElement

function outgoing(overrides: Partial<OutgoingWebhookOverview> = {}): OutgoingWebhookOverview {
  return {
    id: 'wh-1',
    name: '顧客台帳（CRM）',
    url: 'https://crm.example.com/line/hook',
    eventTypes: ['friend.added'],
    hasSecret: true,
    isActive: true,
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-09-30T10:12:00.000Z',
    deliverySummary: {
      periodDays: 30,
      total: 1204,
      succeeded: 1204,
      failed: 0,
      pending: 0,
      successRate: 1,
      lastResult: { status: 'succeeded', responseStatus: 200, completedAt: '2026-09-30T10:12:00.000Z', failureReason: null },
      canRetry: false,
    },
    ...overrides,
  }
}

let outgoingItems: OutgoingWebhookOverview[] = [outgoing()]

const json = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

beforeEach(() => {
  outgoingItems = [outgoing()]
  staffRole = 'owner'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/staff/me') || url.includes('/staff/me')) {
      return json({ success: true, data: { role: staffRole } })
    }
    if (url.includes('/incoming')) return json({ success: true, data: [] })
    if (url.includes('/api/webhooks/outgoing')) {
      return json({ success: true, data: outgoingItems })
    }
    if (url.includes('/interactions')) {
      return json({ success: true, data: { summary: {
        total: 2146, outgoing: 1734, incoming: 412, succeeded: 2144,
        failed: 2, resultUnknown: 0, outgoingFailed: 2, retryable: 2, averageDurationMs: 400,
      } } })
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

test('v8 では ZSbFY の一覧（帯・表・動いているの札）が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="ZSbFY"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('外部連携')
  expect(board?.textContent).toContain('こちらから送る')
  // 数の帯：口にある数だけ出す（送り先 6→1件・今月送った 1,734回）。
  expect(board?.textContent).toContain('1,734')
  // 表の行：いつ送るか・送るもの・ようすの札。
  expect(board?.textContent).toContain('友だちが追加されたとき')
  expect(board?.textContent).toContain('動いている')
  expect(board?.textContent).toContain('設定')
})

test('v8 で失敗がある行は失敗ありの札と失敗の内訳が出る', async () => {
  outgoingItems = [outgoing({
    id: 'wh-2', name: '予約台帳',
    deliverySummary: {
      periodDays: 30, total: 128, succeeded: 126, failed: 2, pending: 0, successRate: 0.98,
      lastResult: { status: 'failed', responseStatus: 500, completedAt: '2026-09-30T09:58:00.000Z', failureReason: 'timeout' },
      canRetry: true,
    },
  })]
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="ZSbFY"]')
  expect(board?.textContent).toContain('失敗あり')
  expect(board?.textContent).toContain('失敗 2回')
  expect(board?.textContent).toContain('失敗をやり直す')
})

test('v8 で何も無いときは wWrpY の「まだ無い」が出る', async () => {
  outgoingItems = []
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="ZSbFY"]')
  expect(board?.textContent).toContain('まだ、送り先はありません')
})

test('v8 の閲覧のみ（l5SRfT）は作るが押せない形になる', async () => {
  staffRole = 'staff'
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="ZSbFY"]')
  expect(board).not.toBeNull()
  const createButton = [...board!.querySelectorAll('button')].find((button) => button.textContent?.includes('送り先を作る'))
  expect(createButton?.disabled).toBe(true)
})

test('v7 では従来の一覧が出て ZSbFY は出ない', async () => {
  await renderPage()
  expect(host.querySelector('[data-design-node="ZSbFY"]')).toBeNull()
})

test('v8 の動かす・止めるは押した瞬間に札が変わり、失敗したら戻る', async () => {
  document.documentElement.dataset.theme = 'v8'
  let resolveUpdate: ((response: Response) => void) | null = null
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/staff/me') || url.includes('/staff/me')) {
      return json({ success: true, data: { role: staffRole } })
    }
    if (url.includes('/incoming')) return json({ success: true, data: [] })
    if (url.includes('/api/webhooks/outgoing') && init?.method && init.method !== 'GET') {
      return new Promise<Response>((resolve) => { resolveUpdate = resolve })
    }
    if (url.includes('/api/webhooks/outgoing')) {
      return json({ success: true, data: outgoingItems })
    }
    if (url.includes('/interactions')) {
      return json({ success: true, data: { summary: {
        total: 2146, outgoing: 1734, incoming: 412, succeeded: 2144,
        failed: 2, resultUnknown: 0, outgoingFailed: 2, retryable: 2, averageDurationMs: 400,
      } } })
    }
    return json({ success: false, error: 'not found' }, 404)
  })
  await renderPage()
  const board = host.querySelector('[data-design-node="ZSbFY"]')!
  expect(board.textContent).toContain('動いている')
  // 「設定」を開いて「止める」を押す。口の返事を待たず札が変わる。
  const settingButton = [...board.querySelectorAll('button')].find((button) => button.textContent?.includes('設定'))!
  await act(async () => { settingButton.click() })
  const stopItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes('止める'))!
  await act(async () => { (stopItem as HTMLElement).click() })
  expect(board.textContent).toContain('止めている')
  // 口が失敗したら札が戻り、知らせに「もう一度」が出る。
  await act(async () => { resolveUpdate!(json({ success: false, error: 'boom' })) })
  expect(board.textContent).toContain('動いている')
})

test('v8 で行を右クリックすると「設定」と同じ操作が押した位置に出る', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/staff/me') || url.includes('/staff/me')) {
      return json({ success: true, data: { role: staffRole } })
    }
    if (url.includes('/incoming')) return json({ success: true, data: [] })
    if (url.includes('/api/webhooks/outgoing') && init?.method === 'PUT') {
      return json({ success: true, data: outgoing() })
    }
    if (url.includes('/api/webhooks/outgoing')) {
      return json({ success: true, data: outgoingItems })
    }
    if (url.includes('/interactions')) {
      return json({ success: true, data: { summary: {
        total: 2146, outgoing: 1734, incoming: 412, succeeded: 2144,
        failed: 2, resultUnknown: 0, outgoingFailed: 2, retryable: 2, averageDurationMs: 400,
      } } })
    }
    return json({ success: false, error: 'not found' }, 404)
  })
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="ZSbFY"]')!
  const row = board.querySelector('tbody tr') as HTMLElement
  await act(async () => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 }))
  })
  const menu = document.querySelector('[role="menu"]')
  expect(menu?.getAttribute('aria-label')).toBe('送り先の操作')
  const layer = document.querySelector('[data-context-menu]')
  expect(layer?.getAttribute('style')).toContain('left: 300px')
  expect(layer?.getAttribute('style')).toContain('top: 200px')
  // 「設定」と同じ中身が出る。
  for (const label of ['止める', '直す', '合言葉を作り直す', '削除する', '試しに送る']) {
    expect(menu?.textContent).toContain(label)
  }
  // 右クリックから「止める」を押すと「設定」と同じく札が変わる。
  const stopItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === '止める') as HTMLElement
  await act(async () => { stopItem.click() })
  expect(board.textContent).toContain('止めている')
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

test('v8 の読み込み中は表の形の骨組みが出て「読み込み中」の文字は無い', async () => {
  document.documentElement.dataset.theme = 'v8'
  vi.useFakeTimers()
  try {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}))
    await act(async () => {
      root.render(<WebhooksPage />)
    })
    // 骨組みは0.3秒待ってから出る。
    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    const board = host.querySelector('[data-design-node="ZSbFY"]')
    expect(board?.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(board?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
    expect(board?.textContent).not.toContain('読み込み中')
  } finally {
    vi.useRealTimers()
  }
})
