// @vitest-environment happy-dom
/**
 * 板 b8xBtZ：問い合わせカード（種類｜店舗・件名・本文・画像・送信者・ボタン）と
 * 履歴の表（受付番号・件名・種類・状態・更新）。下部追従バーは出さない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  context: vi.fn(async () => ({
    success: true,
    data: {
      kinds: [{ key: 'trouble', label: '不具合' }],
      accounts: [{ id: 'line-1', name: '本店' }],
      sender: { tenantName: '統括テスト', name: '山田 太郎', email: 'owner@example.com', planLabel: 'スタンダード' },
    },
  })),
  list: vi.fn(async () => ({
    success: true,
    data: [
      { id: 'req-1', ticketLabel: '#1042', subject: 'Webhook が遅れる', kindLabel: '不具合', status: 'open', createdAt: '2026-09-30T11:00:00+09:00', replies: [] },
    ],
  })),
  create: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: { hqSupport: calls } }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageChrome: () => ({}) }))
vi.mock('@/components/tenant-access-context', () => ({ useTenantStatus: () => 'active' }))
vi.mock('@/components/hq/notice-line-register-dialog', () => ({ default: () => <div data-line-guide /> }))

import HqSupportPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

describe('b8xBtZ お問い合わせの並び', () => {
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

  it('カードに種類・店舗・件名・本文・送信者と、右下にクリア・送信がある', async () => {
    await act(async () => { root.render(<HqSupportPage />) })
    await settle()
    const text = host.textContent ?? ''
    for (const word of ['種類', '関係する店舗', '件名', '本文', '画像を添える', '送信者：山田 太郎', '内容をクリア', '送信']) {
      expect(text).toContain(word)
    }
  })

  it('履歴は表で受付番号・件名・種類・状態・更新を出す', async () => {
    await act(async () => { root.render(<HqSupportPage />) })
    await settle()
    const headers = [...host.querySelectorAll('th')].map((th) => th.textContent)
    expect(headers).toEqual(['受付番号', '件名', '種類', '状態', '更新'])
    const text = host.textContent ?? ''
    expect(text).toContain('#1042')
    expect(text).toContain('Webhook が遅れる')
  })

  it('統括の設定メニューで今の画面が分かる', async () => {
    await act(async () => { root.render(<HqSupportPage />) })
    await settle()
    const current = host.querySelector('[aria-current="page"]')
    expect(current?.textContent).toContain('お問い合わせ')
  })
})
