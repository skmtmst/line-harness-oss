// @vitest-environment happy-dom
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { expectPermissionLocked } from '@/test-utils/permission-locked-control'
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
const writes: Array<{ path: string; method: string }> = []

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
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
    verifiedStaffRole(null)
    writes.length = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : String(input)
      const path = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw
      if (init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method)) writes.push({ path, method: init.method })
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
    verifiedStaffRole(null)
  })

  it('統括には送り先の作成を出す', async () => {
    staffRole = 'owner'
    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()
    expect(host.textContent).toContain('最初の送り先を作る')
    expect(host.textContent).not.toContain('送り先の作成は統括だけができます')
  })

  it('管理者には送り先の作成を出し、作成画面へ進める', async () => {
    staffRole = 'admin'
    await act(async () => { root.render(<WebhooksPage />) })
    await settle()
    const create = [...host.querySelectorAll('a')].find(link => link.textContent?.includes('最初の送り先を作る'))
    expect(create?.getAttribute('href')).toBe('/webhooks/new')
    expect(create?.getAttribute('aria-disabled')).not.toBe('true')
    expect(host.textContent).not.toContain('この画面を変える権限がありません。')
    expect(writes).toEqual([])
  })

  it.each(['staff', 'viewer'])('本人が%sなら手元の統括の保存値にかかわらず作成を拒否する', async role => {
    staffRole = role
    window.localStorage.setItem('lh_staff_role', 'owner')
    try {
      for (const tabQuery of ['', 'tab=incoming', 'tab=notify']) {
        query = tabQuery
        await act(async () => { root.render(<WebhooksPage />) })
        await settle()
        const label = !tabQuery ? '最初の送り先を作る' : tabQuery === 'tab=incoming' ? '受け取り口を作る' : 'この見本で作る'
        const create = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(label))
        await expectPermissionLocked(create)
        expect(host.querySelector('a[href="/webhooks/new"]')).toBeNull()
        expect(host.querySelector('a[href^="/webhooks/new?event="]')).toBeNull()
        expect(host.querySelector('a[href^="/webhooks?tab=incoming&source="]')).toBeNull()
        expect(writes).toEqual([])
      }
    } finally { window.localStorage.removeItem('lh_staff_role') }
  })

  it('本人が管理者なら作成できても、手元の統括の値で鍵やMCPを作れない', async () => {
    staffRole = 'admin'
    window.localStorage.setItem('lh_staff_role', 'owner')
    try {
      await act(async () => { root.render(<WebhooksPage />) })
      await settle()
      expect(host.querySelector('a[href="/webhooks/new"]')).not.toBeNull()
      query = 'tab=api-tokens'
      await act(async () => { root.render(<WebhooksPage />) })
      await settle()
      await expectPermissionLocked([...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'API 接続の鍵を発行する'))
      const mcp = host.querySelector('[data-design-node="Xb0yc"]')
      expect(mcp).not.toBeNull()
      await expectPermissionLocked([...mcp!.querySelectorAll('button')].find(button => button.textContent?.trim() === '接続を作る'))
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(writes).toEqual([])
    } finally { window.localStorage.removeItem('lh_staff_role') }
  })

  it('管理者には受け取り口の作成を出し、書き込み前に入力窓を開く', async () => {
    query = 'tab=incoming'
    staffRole = 'admin'
    await act(async () => { root.render(<WebhooksPage />) })
    await settle()
    const create = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '受け取り口を作る')
    expect(create).toBeTruthy()
    expect(create?.getAttribute('aria-disabled')).not.toBe('true')
    expect(create?.disabled).toBe(false)
    await act(async () => { create!.click() })
    await settle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(writes).toEqual([])
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
    await act(async () => { (host.querySelector('button[aria-label^="受け取り口"]') as HTMLButtonElement).click() })
    await settle()
    expect(host.querySelector('[data-truncated-text][aria-label]')?.getAttribute('aria-label')).toBe(`${base}/api/webhooks/incoming/iwh-1/receive`)
  })

  it('統括には見本から作るを出す（受け取る・送るの両方）', async () => {
    staffRole = 'owner'
    for (const tabQuery of ['', 'tab=incoming']) {
      query = tabQuery
      await act(async () => {
        root.render(<WebhooksPage />)
      })
      await settle()
      expect(host.textContent, `owner ${tabQuery || 'outgoing'}`).toContain('見本から作る')
      act(() => {
        root.unmount()
      })
      host.remove()
      host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
    }
  })

  it('管理者には受け取る・送るの両方で見本の入口を出す', async () => {
    for (const tabQuery of ['', 'tab=incoming']) {
      query = tabQuery
      staffRole = 'admin'
      await act(async () => { root.render(<WebhooksPage />) })
      await settle()
      const sample = [...host.querySelectorAll('a')].find(link => link.textContent?.includes('見本から作る'))
      expect(sample?.getAttribute('href')).toBe('/webhooks?tab=notify')
      expect(sample?.getAttribute('aria-disabled')).not.toBe('true')
      expect(host.textContent).not.toContain('この画面を変える権限がありません。')
      expect(writes).toEqual([])
      act(() => { root.unmount() })
      host.remove()
      host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
    }
  })

  it('統括には見本タブの作成を出す', async () => {
    query = 'tab=notify'
    staffRole = 'owner'
    await act(async () => {
      root.render(<WebhooksPage />)
    })
    await settle()
    expect(host.textContent).toContain('この見本で作る')
    expect(host.querySelector('a[href^="/webhooks/new?event="]')).not.toBeNull()
  })

  it('管理者には見本から受け取り口と送り先へ進む入口を出す', async () => {
    query = 'tab=notify'
    staffRole = 'admin'
    await act(async () => { root.render(<WebhooksPage />) })
    await settle()
    const creates = [...host.querySelectorAll('a')].filter(link => link.textContent?.trim() === 'この見本で作る')
    expect(creates.length).toBeGreaterThan(0)
    expect(creates.every(link => link.getAttribute('aria-disabled') !== 'true')).toBe(true)
    expect(creates.some(link => link.getAttribute('href')?.startsWith('/webhooks/new?event='))).toBe(true)
    expect(creates.some(link => link.getAttribute('href')?.startsWith('/webhooks?tab=incoming&source='))).toBe(true)
    expect(host.textContent).not.toContain('この画面を変える権限がありません。')
    expect(writes).toEqual([])
  })

})
