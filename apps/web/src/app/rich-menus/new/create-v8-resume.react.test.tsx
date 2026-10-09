// @vitest-environment happy-dom
/*
 * ★V8 リッチメニューを作る：`?id=<下書き>&step=buttons` で作りかけの下書きを開き直す（板 Z0uO6・kmTab）。
 * - 下書きを読んで手順②（ボタンの動き）の面の一覧を出す
 * - 手順①は済み、③④は未着手のまま（開き直しただけで全部済みにしない）
 * - 読めなければ理由を出す
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
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
    if (path === '/api/staff/me') return { ok: true, status: 200, json: async () => ({ success: true, data: { role: 'owner' } }) }
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

  it('店でも案Aの形を選ぶと、A・Bに対応する2面の座標を作成APIへ送る', async () => {
    window.history.replaceState(null, '', '/rich-menus/new')
    type CreatedInput = { pages: Array<{ areas: Array<{ boundsY: number; boundsHeight: number }> }> }
    let input: CreatedInput | null = null
    const original = fetch
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url), 'http://localhost').pathname
      if (path === '/api/rich-menu-groups' && init?.method === 'POST') {
        input = JSON.parse(String(init.body))
        return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'rmg-x', pages: [{ id: 'p-top' }] } }) }
      }
      if (path === '/api/rich-menu-groups/rmg-x' && input) {
        const created: CreatedInput = input
        return { ok: true, status: 200, json: async () => ({ success: true, data: { ...GROUP, pages: [{ ...GROUP.pages[0], areas: created.pages[0].areas.map((area: object, index: number) => ({ ...area, id: `area-${index}` })) }] } }) }
      }
      return original(url as RequestInfo, init)
    }))
    await act(async () => { root.render(<RichMenuCreateV8 />) })
    await settle()
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: '1面（面 A）' })) })
    await act(async () => { fireEvent.keyDown(screen.getByRole('radio', { name: '1面（面 A）' }), { key: 'ArrowRight' }) })
    expect((screen.getByRole('radio', { name: '上下2面（面 A・B）' }) as HTMLInputElement).checked).toBe(true)
    await act(async () => { fireEvent.change(screen.getByLabelText('メニュー名（友だちには見えません）'), { target: { value: '店の2面メニュー' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '次へ：ボタンの動き' })) })
    await settle()
    expect(input).not.toBeNull()
    const created = input as unknown as CreatedInput
    expect(created.pages[0].areas.map((area) => [area.boundsY, area.boundsHeight])).toEqual([[0, 843], [843, 843]])
    expect(screen.getAllByRole('button', { name: /^面 [AB]、動きは/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^面 C、/ })).toBeNull()
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
    expect(host.querySelector('button[aria-label="形と画像に戻る"]')).not.toBeNull()
    expect(Array.from(host.querySelectorAll('button')).some((b) => (b.getAttribute('aria-label') ?? '').includes('誰に出すか'))).toBe(false)
  })

  it('下書きが読めなければ理由を出す', async () => {
    groupStatus = 404
    await act(async () => { root.render(<RichMenuCreateV8 />) })
    await settle()
    expect(host.textContent).toContain('作りかけの下書きを開けませんでした')
  })
  it('WEB287：保存待ち中は名前と文言を編集できない', async () => {
    window.history.replaceState(null, '', '/rich-menus/new?id=rmg-x&step=shape')
    const original = vi.mocked(fetch).getMockImplementation()!
    let release!: (v: unknown) => void
    vi.mocked(fetch).mockImplementation((input, init) => init?.method === 'PATCH' ? new Promise(resolve => { release = resolve as never }) : original(input, init))
    await act(async () => root.render(<RichMenuCreateV8 />)); await settle()
    const name = host.querySelector('#rm-name') as HTMLInputElement
    expect(name).toBeTruthy()
    await act(async () => fireEvent.change(name, { target: { value: '直した名前' } }))
    const save = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '下書きを保存')!
    await act(async () => fireEvent.click(save)); await settle()
    expect(typeof release).toBe('function')
    expect(name.closest('fieldset[disabled]')).not.toBeNull()
    await act(async () => release({ ok: false, status: 500, json: async () => ({ success: false, error: 'down' }) }))
    await settle(); expect(name.closest('fieldset[disabled]')).toBeNull()
    expect(name.value).toBe('直した名前')
  })

  it('WEB-286: 作成後の読み直しが失敗しても同じ下書きから再開する', async () => {
    window.history.replaceState(null, '', '/rich-menus/new')
    const original = fetch
    let creates = 0, reads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url), 'http://localhost').pathname
      if (path === '/api/rich-menu-groups' && init?.method === 'POST') {
        creates += 1
        return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'rmg-x', pages: [{ id: 'p-top' }] } }) }
      }
      if (path === '/api/rich-menu-groups/rmg-x') {
        reads += 1
        if (reads === 1) return { ok: false, status: 500, json: async () => ({ success: false, error: '通信失敗' }) }
      }
      return original(url as RequestInfo, init)
    }))
    await act(async () => { root.render(<RichMenuCreateV8 />) })
    await settle()
    await act(async () => { fireEvent.change(screen.getByLabelText('メニュー名（友だちには見えません）'), { target: { value: '再開' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '次へ：ボタンの動き' })) })
    await settle()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '次へ：ボタンの動き' })) })
    await settle()
    expect(creates).toBe(1)
    expect(host.textContent).toContain('切替タブ（ページ）')
  })

  it('WEB-287: 保存中に変えた名前を読み直した下書きで消さない', async () => {
    window.history.replaceState(null, '', '/rich-menus/new?id=rmg-x&step=shape')
    const original = fetch
    let finish!: (v: unknown) => void
    vi.stubGlobal('fetch', vi.fn((url: unknown, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Promise(r => { finish = r })
      return original(url as RequestInfo, init)
    }))
    await act(async () => { root.render(<RichMenuCreateV8 />) })
    await settle()
    const name = screen.getByLabelText('メニュー名（友だちには見えません）')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    await act(async () => { fireEvent.change(name, { target: { value: '保存中の追加入力' } }) })
    await act(async () => finish({ ok: true, status: 200, json: async () => ({ success: true, data: GROUP }) }))
    await settle()
    expect((screen.getByLabelText('メニュー名（友だちには見えません）') as HTMLInputElement).value).toBe('保存中の追加入力')
  })

  it('WEB-289: 公開前の検査を取得できない間は公開を押せない', async () => {
    window.history.replaceState(null, '', '/rich-menus/new?id=rmg-x&step=publish')
    const original = fetch
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('prepublish-check')) return { ok: false, status: 500, json: async () => ({ success: false, error: '通信失敗' }) }
      return original(url as RequestInfo, init)
    }))
    await act(async () => { root.render(<RichMenuCreateV8 />) })
    await settle()
    expect((screen.getByRole('button', { name: '公開する' }) as HTMLButtonElement).disabled).toBe(true)
  })

})
