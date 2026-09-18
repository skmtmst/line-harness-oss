// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlatformNotices from './platform-notices'
import NoticeLineRegisterDialog from './notice-line-register-dialog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,QR' } }))

/**
 * ★V6 37-7 統括側。運営からのお知らせは「読みました」で消え、
 * 契約者専用LINEの登録案内は QR・確認コード・友だち追加リンクを出す（決定 2026-09-18: 案内だけ、ログインは止めない）。
 */

let host: HTMLDivElement
let root: Root
let calls: Array<{ url: string; method: string }>
let registration: unknown

beforeEach(() => {
  calls = []
  registration = { available: true, accountName: 'musubo 運営（契約者専用）', basicId: '@musubo', addFriendUrl: 'https://line.me/R/ti/p/@musubo', linked: false, code: '123456', codeExpiresAt: '2026-09-19T00:00:00.000Z' }
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    let payload: unknown
    if (url.endsWith('/api/hq/notices')) payload = { success: true, data: [{ id: 'n1', subject: '9月20日 深夜のメンテナンス', body: '2:00〜4:00 に止まります。', sentAt: '2026-09-17T10:00:00.000+09:00' }] }
    else if (url.endsWith('/read')) payload = { success: true, data: { read: true } }
    else if (url.endsWith('/api/hq/notices/line-registration')) payload = { success: true, data: registration }
    else payload = { success: true, data: null }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)

describe('運営からのお知らせ', () => {
  it('未読を出し、「読みました」で API を呼んで消す', async () => {
    await act(async () => { root.render(<PlatformNotices />) })
    await flush()
    expect(host.textContent).toContain('9月20日 深夜のメンテナンス')
    expect(host.textContent).toContain('musubo 運営')
    await act(async () => { button('読みました')!.click() })
    await flush()
    expect(calls.some((c) => c.url.endsWith('/api/hq/notices/n1/read') && c.method === 'POST')).toBe(true)
    expect(host.textContent).not.toContain('9月20日 深夜のメンテナンス')
  })
})

describe('契約者専用LINEの登録案内', () => {
  it('QR・確認コード・友だち追加リンクを出し、「あとで確認する」で閉じる', async () => {
    const onClose = vi.fn()
    await act(async () => { root.render(<NoticeLineRegisterDialog open onClose={onClose} />) })
    await flush()
    const text = document.body.textContent ?? ''
    expect(text).toContain('musubo 運営（契約者専用）の LINE を登録してください')
    expect(text).toContain('musubo 運営（契約者専用）（@musubo）')
    expect(text).toContain('123456')
    expect(document.querySelector('img[src^="data:image/png"]')).not.toBeNull()
    expect(document.querySelector('a[href="https://line.me/R/ti/p/@musubo"]')).not.toBeNull()
    await act(async () => { button('あとで確認する')!.click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('運営側で未設定のときは、自動表示なら何も出さずに閉じ、手動なら準備中の案内を出す', async () => {
    registration = { available: false }
    const onClose = vi.fn()
    await act(async () => { root.render(<NoticeLineRegisterDialog open onClose={onClose} />) })
    await flush()
    expect(onClose).toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('登録してください')

    act(() => root.unmount())
    root = createRoot(host)
    const onClose2 = vi.fn()
    await act(async () => { root.render(<NoticeLineRegisterDialog open onClose={onClose2} quietWhenUnavailable={false} />) })
    await flush()
    expect(onClose2).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('契約者専用LINEはまだ運営側で設定されていません')
  })

  it('登録済みなら確認コードの代わりに登録済みと出す', async () => {
    registration = { available: true, accountName: 'musubo 運営（契約者専用）', basicId: null, addFriendUrl: 'https://line.me/R/ti/p/@musubo', linked: true, code: null, codeExpiresAt: null }
    await act(async () => { root.render(<NoticeLineRegisterDialog open onClose={() => {}} />) })
    await flush()
    expect(document.body.textContent).toContain('この管理画面はすでに登録済みです')
  })
})
