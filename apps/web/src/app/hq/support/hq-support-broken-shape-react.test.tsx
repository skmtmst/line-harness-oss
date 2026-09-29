// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 撮影用偽APIの既定の器（`{items,total,page,limit}`）が返ってきても落ちないこと。
 * 2026-09-25 に `/api/hq/support/context` の口が偽APIになく、この形が返って
 * `kinds.map` で `TypeError: Cannot read properties of undefined (reading 'map')`
 * となり /hq/support が真っ白になった。再発防止。
 */
const calls = vi.hoisted(() => ({
  context: vi.fn(async () => ({
    success: true,
    data: { items: [], total: 0, page: 1, limit: 20 },
  })),
  list: vi.fn(async () => ({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } })),
  create: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: { hqSupport: calls } }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/tenant-access-context', () => ({ useTenantStatus: () => 'active' }))
vi.mock('@/components/hq/notice-line-register-dialog', () => ({ default: () => <div data-line-guide /> }))

import HqSupportPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

describe('形の違う表示用情報でもお問い合わせは落ちない', () => {
  beforeEach(() => {
    calls.context.mockClear()
    calls.list.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('種類・店舗・送信者が無くても入力欄を出し、履歴は読み直しを促す', async () => {
    await act(async () => { root.render(<HqSupportPage />) })
    await settle()

    expect(host.textContent).toContain('問い合わせ内容')
    expect(host.textContent).toContain('種類を選んでください')
    expect(host.textContent).toContain('送信者')
    expect(host.textContent).toContain('読み込めませんでした')
  })
})
