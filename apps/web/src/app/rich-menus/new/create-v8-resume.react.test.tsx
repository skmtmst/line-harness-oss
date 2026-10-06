// @vitest-environment happy-dom
/*
 * ★V8 リッチメニューを作る：`?id=<下書き>&step=buttons` で作りかけの下書きを開き直す（板 Z0uO6・kmTab）。
 * - 下書きを読んで手順②（ボタンの動き）の面の一覧を出す
 * - 手順①は済み、③④は未着手のまま（開き直しただけで全部済みにしない）
 * - 読めなければ理由を出す
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: ACCOUNT, loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/rich-menus/new',
}))

const ACCOUNT = { id: 'acc-1', name: '店舗A' }

import RichMenuCreateV8 from './create-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const area = (id: string, label: string, x: number, uri: string) => ({
  id, boundsX: x, boundsY: 0, boundsWidth: 833, boundsHeight: 843, actionType: 'uri',
  actionData: uri ? { uri } : {}, intent: 'url', label, tagIds: [], scoreChange: null,
  templateId: null, formId: null, trackedLinkId: null,
})
const GROUP = {
  id: 'rmg-x', accountId: 'acc-1', name: '通常メニュー（会員向け）', chatBarText: 'メニュー', size: 'large',
  isDefaultForAll: true, status: 'draft', targetingPriority: 1, targetingEnabled: false, targetingCondition: null,
  folderId: null, displayOrder: 1, version: 1, defaultPageId: 'p-top',
  pages: [
    { id: 'p-top', orderIndex: 0, name: 'トップ', aliasId: 'a-top', lineRichmenuId: null, imageR2Key: null, imageContentType: null,
      areas: [area('a-1', '予約する', 0, 'https://nen.example/booking'), area('a-2', '会員証', 833, '')] },
    { id: 'p-tab', orderIndex: 1, name: 'タブA：予約', aliasId: 'a-tab', lineRichmenuId: null, imageR2Key: null, imageContentType: null, areas: [] },
  ],
}

let host: HTMLDivElement
let root: Root
let groupStatus = 200

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const path = new URL(String(url), 'http://localhost').pathname
    if (path === '/api/rich-menu-groups/rmg-x') {
      return groupStatus === 200
        ? { ok: true, status: 200, json: async () => ({ success: true, data: GROUP }) }
        : { ok: false, status: groupStatus, json: async () => ({ success: false, error: 'not found' }) }
    }
    if (path === '/api/rich-menu-groups') {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [], total: 0, page: 1, limit: 200 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
  }))
}

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('作りかけの下書きを ?id= で開き直す', () => {
  beforeEach(() => {
    groupStatus = 200
    window.history.replaceState(null, '', '/rich-menus/new?id=rmg-x&step=buttons')
    stubFetch()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it('手順②に下書きのページと面を出し、①だけ済みにする', async () => {
    await act(async () => { root.render(<RichMenuCreateV8 />) })
    await settle()
    const text = host.textContent ?? ''
    expect(text).toContain('切替タブ（ページ）')
    expect(text).toContain('タブA：予約')
    const rows = Array.from(host.querySelectorAll('button[aria-pressed]')).map((b) => b.textContent ?? '')
    expect(rows.some((t) => t.includes('予約する') && t.includes('URLを開く'))).toBe(true)
    expect(rows.some((t) => t.includes('会員証') && t.includes('未設定'))).toBe(true)
    // ①は戻れる（済み）、③④はまだ押せない（未着手）。
    expect(host.querySelector('button[aria-label="形と画像へ戻る"]')).not.toBeNull()
    expect(Array.from(host.querySelectorAll('button')).some((b) => (b.getAttribute('aria-label') ?? '').includes('誰に出すか'))).toBe(false)
  })

  it('下書きが読めなければ理由を出す', async () => {
    groupStatus = 404
    await act(async () => { root.render(<RichMenuCreateV8 />) })
    await settle()
    expect(host.textContent).toContain('作りかけの下書きを開けませんでした')
  })
})
