// @vitest-environment happy-dom
/*
 * R32: 受け取り口・送り先の作成は統括だけに出す。
 * C33: 受け取り口のURLはAPIの住所で組み立てる。
 * 本物のReactで動かして見る（空・正常・権限別の出し分け）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let query = ''
let staffRole = 'owner'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(query),
}))

import WebhooksPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

describe('R32/C33 外部連携の権限連動と受け取りURL', () => {
  beforeEach(() => {
    query = ''
    staffRole = 'owner'
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const raw = typeof input === 'string' ? input : String(input)
      const path = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw
      let body: unknown = { success: true, data: [] }
      if (path.startsWith('/api/staff/me')) {
        body = { success: true, data: { id: 's-1', name: '担当', role: staffRole, email: null } }
      } else if (/^\/api\/webhooks\/incoming\/[^/]+/.test(path)) {
        // 詳細は取れない設定。受け取りURLの帯は詳細なしでも描く。
        body = { success: false, error: 'not found' }
      } else if (path.startsWith('/api/webhooks/incoming')) {
        body = { success: true, data: [incoming('iwh-1')] }
      } else if (path.startsWith('/api/webhooks/interactions')) {
        body = interactionsSummary()
      }
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

  it('統括には送り先の作成を出す', async () => {
    staffRole = 'owner'
    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()
    expect(host.textContent).toContain('＋ 送り先を作る')
    expect(host.textContent).not.toContain('送り先の作成は統括だけができます')
  })

  it('管理者には送り先の作成を出さず、統括への依頼を案内する', async () => {
    staffRole = 'admin'
    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()
    expect(host.textContent).not.toContain('＋ 送り先を作る')
    expect(host.textContent).toContain('送り先の作成は統括だけができます。必要なときは統括に頼んでください。')
  })

  it('管理者には受け取り口の作成を出さず、統括への依頼を案内する', async () => {
    query = 'tab=incoming'
    staffRole = 'admin'
    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()
    expect(host.textContent).not.toContain('＋ 受け取り口を作る')
    expect(host.textContent).toContain('受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。')
  })

  it('受け取り口のURLはAPIの住所で組み立てる', async () => {
    query = 'tab=incoming'
    staffRole = 'owner'
    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()
    const base = process.env.NEXT_PUBLIC_API_URL ?? ''
    expect(base).not.toBe('')
    expect(host.textContent).toContain(`${base}/api/webhooks/incoming/iwh-1/receive`)
  })
})
