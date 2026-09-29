// @vitest-environment happy-dom
/*
 * #980: 外部連携のタブ件数が、一覧と同じ取得結果の総数に連動することを
 * 本物のReactで動かして見る。
 *
 * 以前は「こちらから送る 6」「こちらで受け取る 3」が設計の写しの固定値で、
 * 一覧が0件のアカウントでもそのまま出ていた。
 * - 件数は選択中アカウントで絞った一覧の総数と同じ
 * - データが変われば数字も変わる
 * - 取得が終わるまでは数字を出さない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

import WebhooksPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let handler: (path: string) => Promise<unknown> | unknown

function outgoing(id: string) {
  return {
    id,
    name: `送り先 ${id}`,
    url: `https://example.com/${id}`,
    eventTypes: ['friend.added'],
    hasSecret: true,
    isActive: true,
    maxRetries: 3,
    consecutiveFailures: 0,
    lastFailedAt: null,
    deliverySummary: {
      periodDays: 30,
      total: 0,
      succeeded: 0,
      failed: 0,
      pending: 0,
      successRate: null,
      lastResult: null,
      canRetry: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function incoming(id: string) {
  return {
    id,
    name: `受け取り口 ${id}`,
    sourceType: 'form',
    hasSecret: true,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function interactionsSummary() {
  return {
    success: true,
    data: {
      items: [],
      total: 0,
      page: 1,
      limit: 1,
      summary: { outgoing: 0, incoming: 0, failed: 0, pending: 0, averageDurationMs: null },
    },
  }
}

/** タブ行（ScrollableTabs）の各タブの文字だけを集める。一覧の「N本のうち」と混ぜない。 */
function tabTexts(): string[] {
  return Array.from(
    host.querySelectorAll('[data-scrollable-tabs] button, [data-scrollable-tabs] a'),
  ).map((el) => el.textContent ?? '')
}

function tabLabel(prefix: string): string | undefined {
  return tabTexts().find((text) => text.startsWith(prefix))
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

describe('#980 外部連携のタブ件数は一覧の取得結果に連動する', () => {
  beforeEach(() => {
    handler = async () => ({ success: true, data: [] })
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const raw = typeof input === 'string' ? input : String(input)
      const path = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw
      const body = await handler(path)
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('送る・受け取るの件数は一覧の総数と同じ', async () => {
    handler = async (path: string) => {
      if (path.startsWith('/api/webhooks/outgoing')) {
        return { success: true, data: [outgoing('owh-1'), outgoing('owh-2')] }
      }
      if (path.startsWith('/api/webhooks/incoming')) {
        return { success: true, data: [incoming('iwh-1'), incoming('iwh-2'), incoming('iwh-3')] }
      }
      if (path.startsWith('/api/webhooks/interactions')) return interactionsSummary()
      return { success: true, data: [] }
    }

    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()

    expect(tabLabel('こちらから送る')).toBe('こちらから送る 2')
    expect(tabLabel('こちらで受け取る')).toBe('こちらで受け取る 3')
  })

  it('データが変わるとタブの数字も変わる', async () => {
    handler = async (path: string) => {
      if (path.startsWith('/api/webhooks/outgoing')) {
        return { success: true, data: [outgoing('owh-1')] }
      }
      if (path.startsWith('/api/webhooks/incoming')) {
        return { success: true, data: [] }
      }
      if (path.startsWith('/api/webhooks/interactions')) return interactionsSummary()
      return { success: true, data: [] }
    }

    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()

    expect(tabLabel('こちらから送る')).toBe('こちらから送る 1')
    expect(tabLabel('こちらで受け取る')).toBe('こちらで受け取る 0')
  })

  it('取得が終わるまでは件数を出さない', async () => {
    // 応答が返らないままの状態では、タブに数字を付けない。
    handler = () => new Promise(() => {})

    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()

    expect(tabLabel('こちらから送る')).toBe('こちらから送る')
    expect(tabLabel('こちらで受け取る')).toBe('こちらで受け取る')
  })
})
