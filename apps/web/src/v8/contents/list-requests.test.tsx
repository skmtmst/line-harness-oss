// @vitest-environment happy-dom
/*
 * ★V8 登録メディア一覧（src/v8/contents/list.tsx）の読み込みの順番と回数。
 * WEB097: 同じアカウントの中で、遅い検索 A の返事が後の検索 B の結果・失敗・読み込み中を上書きしない。
 * WEB098: 検索・ページ送りでは一覧だけを読み直し、容量・「すべて」の総数・フォルダ・数の帯は読み直さない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))

import MediaLibraryListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const item = (id: string, filename: string) => ({
  id, lineAccountId: 'account-a', folderId: null, filename, kind: 'image', mimeType: 'image/jpeg', sizeBytes: 1000,
  width: 10, height: 10, durationMs: null, usageCount: 1, archivedAt: null, archiveReason: null,
  url: `https://example.test/${id}.jpg`, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
})
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement
let calls: string[] = []
/** 検索語ごとに返事を止めておく口。 */
let gates = new Map<string, Promise<void>>()
let failQuery: string | null = null

beforeEach(() => {
  calls = []
  gates = new Map()
  failQuery = null
  document.documentElement.dataset.theme = 'v8'
  window.history.replaceState(null, '', '/contents')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/api/staff/me')) return json({ success: true, data: { id: 'staff-1', role: 'admin' } })
    if (url.includes('/api/media/quota')) {
      return json({ success: true, data: { usageBytes: 1, reservedBytes: 0, limitBytes: 100, remainingBytes: 99, usageRate: 0.01, state: 'normal' } })
    }
    if (url.includes('/api/folders')) return json({ success: true, data: [], unfiledCount: 0 })
    if (url.includes('/api/media?') || url.endsWith('/api/media')) {
      const params = new URL(url, 'http://worker.test').searchParams
      const query = params.get('query') ?? ''
      const gate = gates.get(query)
      if (gate) await gate
      if (failQuery !== null && query === failQuery) return json({ success: false, error: 'boom' }, 500)
      const items = query ? [item(`m-${query}`, `${query}の結果.jpg`)] : [item('m-0', 'はじめの一枚.jpg')]
      return json({ success: true, data: { items, total: items.length, limit: Number(params.get('limit') ?? 20), offset: 0 } })
    }
    return json({ success: false, error: 'not mocked' }, 404)
  }))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
})

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
const searchBox = () => host.querySelector('input[aria-label="ファイル名で探す"]') as HTMLInputElement
const typeSearch = async (value: string) => {
  await act(async () => {
    const input = searchBox()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const count = (predicate: (url: string) => boolean) => calls.filter(predicate).length
const isQuota = (url: string) => url.includes('/api/media/quota')
const isFolders = (url: string) => url.includes('/api/folders')
const isOneRow = (url: string) => /\/api\/media\?/.test(url) && new URL(url, 'http://worker.test').searchParams.get('limit') === '1'

describe('検索の世代（WEB097）', () => {
  it('遅い検索 A の返事は、後の検索 B の結果を上書きしない', async () => {
    await act(async () => root.render(<MediaLibraryListV8 />))
    await settle()
    expect(host.textContent).toContain('はじめの一枚.jpg')

    let releaseA: () => void = () => {}
    gates.set('りんご', new Promise<void>((resolve) => { releaseA = resolve }))
    await typeSearch('りんご')
    await settle()
    await typeSearch('みかん')
    await settle()
    expect(host.textContent).toContain('みかんの結果.jpg')

    await act(async () => { releaseA() })
    await settle()
    expect(host.textContent).toContain('みかんの結果.jpg')
    expect(host.textContent).not.toContain('りんごの結果.jpg')
  })

  it('遅い検索 A の失敗は、後の検索 B の結果を失敗表示に変えない', async () => {
    await act(async () => root.render(<MediaLibraryListV8 />))
    await settle()
    let releaseA: () => void = () => {}
    gates.set('りんご', new Promise<void>((resolve) => { releaseA = resolve }))
    failQuery = 'りんご'
    await typeSearch('りんご')
    await settle()
    await typeSearch('みかん')
    await settle()
    await act(async () => { releaseA() })
    await settle()
    expect(host.textContent).toContain('みかんの結果.jpg')
    expect(host.textContent).not.toContain('読み込めませんでした')
  })
})

describe('読み直す範囲（WEB098）', () => {
  it('検索では一覧だけを読み直し、容量・総数・フォルダ・数の帯は読み直さない', async () => {
    await act(async () => root.render(<MediaLibraryListV8 />))
    await settle()
    const before = { quota: count(isQuota), folders: count(isFolders), oneRow: count(isOneRow) }
    expect(before.quota).toBe(1)
    expect(before.folders).toBe(1)

    await typeSearch('みかん')
    await settle()
    expect(host.textContent).toContain('みかんの結果.jpg')
    expect(count(isQuota)).toBe(before.quota)
    expect(count(isFolders)).toBe(before.folders)
    expect(count(isOneRow)).toBe(before.oneRow)
  })
})
