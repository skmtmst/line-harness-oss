// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import MediaLibraryPage from './page'

// happy-dom では import.meta.url が file 形にならないため、作業場所からの相対で読む。
const LIST_V8 = readFileSync('src/app/contents/list-v8.tsx', 'utf8')
const PAGE = readFileSync('src/app/contents/page.tsx', 'utf8')

/*
 * ★V8 登録メディア一覧（板 `O7hUt7`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい一覧に切り替わり、
 * 数の帯・フォルダの列・道具の段・札の格子・表示範囲とページ送りが出ること、
 * staff では閲覧のみの帯が出て管理操作が押せない形になることを実DOMで固定する。
 * v7 では従来の一覧（`g89Tc`）が出ることも固定する。
 * 帯の数は API の実値だけ（見本の数を直書きしない）。
 */
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a', selectedAccount: null, loading: false,
  }),
}))

let staffRole: 'admin' | 'staff' = 'admin'

const mediaItems = [
  {
    id: 'media-photo',
    lineAccountId: 'account-a',
    folderId: 'mf-photo',
    filename: '秋の新商品.jpg',
    kind: 'image',
    mimeType: 'image/jpeg',
    sizeBytes: 1200000,
    width: 1200,
    height: 800,
    durationMs: null,
    usageCount: 2,
    archivedAt: null,
    archiveReason: null,
    url: 'https://example.test/photo.jpg',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  },
  {
    id: 'media-movie',
    lineAccountId: 'account-a',
    folderId: null,
    filename: '使い方ガイド.mp4',
    kind: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 38000000,
    width: null,
    height: null,
    durationMs: 60000,
    usageCount: 1,
    archivedAt: null,
    archiveReason: null,
    url: 'https://example.test/movie.mp4',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  },
  {
    id: 'media-doc',
    lineAccountId: 'account-a',
    folderId: null,
    filename: 'メニュー表.pdf',
    kind: 'file',
    mimeType: 'application/pdf',
    sizeBytes: 2100000,
    width: null,
    height: null,
    durationMs: null,
    usageCount: 0,
    archivedAt: null,
    archiveReason: null,
    url: 'https://example.test/doc.pdf',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  },
]

const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

let root: Root | null = null
let host: HTMLDivElement | null = null

/* happy-dom に localStorage が無いときの小さな代替。役割の読み書きだけに使う。 */
function ensureStorage() {
  if (typeof window.localStorage !== 'undefined' && window.localStorage !== null) return
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
    },
  })
}

beforeEach(() => {
  ensureStorage()
  staffRole = 'admin'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/staff/me')) {
      return response({ success: true, data: { id: 'staff-1', role: staffRole } })
    }
    if (url.includes('/api/media/quota')) {
      return response({
        success: true,
        data: {
          usageBytes: 3200000000,
          reservedBytes: 0,
          limitBytes: 10000000000,
          remainingBytes: 6800000000,
          usageRate: 0.32,
          state: 'normal',
        },
      })
    }
    if (url.includes('/api/media?') || url.endsWith('/api/media')) {
      const query = new URL(url, 'http://worker.test').searchParams
      let filtered = [...mediaItems]
      const kind = query.get('kind')
      if (kind) filtered = filtered.filter((item) => item.kind === kind)
      if (query.get('unusedOnly') === '1') filtered = filtered.filter((item) => item.usageCount === 0)
      if (query.get('archived') === 'only') filtered = filtered.filter((item) => item.archivedAt != null)
      else filtered = filtered.filter((item) => item.archivedAt == null)
      const limit = Number(query.get('limit') ?? '20')
      const offset = Number(query.get('offset') ?? '0')
      return response({ success: true, data: { items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset } })
    }
    if (url.includes('/api/folders')) {
      return response({
        success: true,
        data: [{ id: 'mf-photo', kind: 'media', name: '01_商品写真', parentId: null, displayOrder: 0, color: '#2f6fde', itemCount: 1 }],
        unfiledCount: 2,
      })
    }
    return response({ success: false, error: 'not mocked' }, 500)
  }))
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
  document.documentElement.removeAttribute('data-theme')
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

async function renderPage() {
  await act(async () => {
    root?.render(<MediaLibraryPage />)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

describe('V8 登録メディア一覧（O7hUt7）の切り替え', () => {
  test('v8 では新しい一覧（O7hUt7）が出て、v7 は出ない', async () => {
    document.documentElement.dataset.theme = 'v8'
    await renderPage()
    expect(host?.querySelector('[data-design-node="O7hUt7"]')).not.toBeNull()
    expect(host?.querySelector('[data-design-node="g89Tc"]')).toBeNull()
    expect(host?.textContent).toContain('登録メディア一覧')
    expect(host?.textContent).toContain('どこでも使っていない')
    expect(host?.textContent).toContain('使っている容量')
    expect(host?.textContent).toContain('アーカイブ')
    expect(host?.textContent).toContain('秋の新商品.jpg')
    expect(host?.textContent).toContain('20件表示')
  })

  test('staff では閲覧のみの帯が出て、管理操作の札は出ない', async () => {
    staffRole = 'staff'
    document.documentElement.dataset.theme = 'v8'
    await renderPage()
    expect(host?.textContent).toContain('閲覧のみで見ています')
    // 登録と取得は staff も使えるので押せるままにする。
    const registerButton = Array.from(host?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('メディアを登録する'))
    expect(registerButton?.hasAttribute('disabled')).toBe(false)
    // 選ぶ札（まとめて削除の口）は管理者だけ。
    expect(host?.textContent).not.toContain('すべてのメディアを選択')
  })

  test('札の名前の前に、左のフォルダの列と同じ色の丸が付く（未分類は輪）。閲覧のみでも出す', async () => {
    staffRole = 'staff'
    document.documentElement.dataset.theme = 'v8'
    await renderPage()
    const dots = [...(host?.querySelectorAll('[data-design-node="O7hUt7"] [data-folder-dot]') ?? [])]
    expect(dots).toHaveLength(mediaItems.length)
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual(['フォルダ：01_商品写真', 'フォルダ：未分類', 'フォルダ：未分類'])
    expect(dots[0].getAttribute('data-folder-dot')).toBe('filed')
    expect(dots[1].getAttribute('data-folder-dot')).toBe('unfiled')
  })

  test('v7 では従来の一覧が出て、新しい一覧は出ない', async () => {
    document.documentElement.dataset.theme = 'v7'
    await renderPage()
    expect(host?.querySelector('[data-design-node="g89Tc"]')).not.toBeNull()
    expect(host?.querySelector('[data-design-node="O7hUt7"]')).toBeNull()
  })
})

describe('V8 登録メディア一覧（O7hUt7）の作り', () => {
  test('v8 のときだけ新しい形を出す分岐を持つ', () => {
    expect(PAGE).toContain("theme === 'v8' ? <MediaLibraryListV8 /> : <MediaLibraryInner />")
    expect(PAGE).toContain('data-design-node="g89Tc"')
  })

  test('数の帯・道具の段・表示範囲とページ送りを持つ', () => {
    expect(LIST_V8).toContain('data-design-node="O7hUt7"')
    expect(LIST_V8).toContain('登録メディアの集計')
    expect(LIST_V8).toContain('使っている容量')
    expect(LIST_V8).toContain('アーカイブ')
    expect(LIST_V8).toContain('ファイル名で検索')
    expect(LIST_V8).toContain('aria-label="並べ方"')
    expect(LIST_V8).toContain('aria-label="並び順"')
    expect(LIST_V8).toContain('aria-label="表示件数"')
    expect(LIST_V8).toContain('10件表示')
    expect(LIST_V8).toContain('50件表示')
    expect(LIST_V8).toContain('<ListRange')
    expect(LIST_V8).toContain('<Pagination')
    expect(LIST_V8).toContain('<BulkBar')
  })

  test('帯の数は実データで数え、種別・未使用・退避の総数を別に読む', () => {
    expect(LIST_V8).toContain('unusedOnly: true')
    expect(LIST_V8).toContain("archived: 'only'")
    expect(LIST_V8).toContain('formatMediaSize(quota.usageBytes)')
    expect(LIST_V8).toContain('quota.limitBytes')
    expect(LIST_V8).toContain('—（未取得）')
    // 見本の数は一例。直書きしない。
    expect(LIST_V8).not.toContain('3.2 GB')
    expect(LIST_V8).not.toContain('10 GB')
    expect(LIST_V8).not.toContain('186')
  })

  test('v6 の列・絞り込み・操作を残す', () => {
    // 列（札の中身）。
    expect(LIST_V8).toContain('formatMediaDetails(item)')
    expect(LIST_V8).toContain('どこでも使っていない')
    expect(LIST_V8).toContain('か所で使用中')
    expect(LIST_V8).toContain('使用先を確認できません')
    // 絞り込み。
    expect(LIST_V8).toContain('selected={showUnusedOnly}')
    expect(LIST_V8).toContain('selected={showNearLimitOnly}')
    expect(LIST_V8).toContain('selected={showArchivedOnly}')
    expect(LIST_V8).toContain('使われている順')
    expect(LIST_V8).toContain('<FolderPanel')
    // 操作。
    expect(LIST_V8).toContain('使用箇所を見る')
    expect(LIST_V8).toContain('名前を変える')
    expect(LIST_V8).toContain('フォルダへ移す')
    expect(LIST_V8).toContain('ダウンロード')
    expect(LIST_V8).toContain('アーカイブ')
    expect(LIST_V8).toContain('削除する')
    expect(LIST_V8).toContain('別のメディアに差し替える')
    expect(LIST_V8).toContain('data-design-node="YfTfJ"')
    expect(LIST_V8).toContain('理由<RequiredBadge />')
    expect(LIST_V8).toContain('選択したメディアを削除')
  })
})
