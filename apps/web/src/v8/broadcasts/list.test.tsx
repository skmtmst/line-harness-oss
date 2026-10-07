// @vitest-environment happy-dom
/*
 * V8 一斉配信一覧（src/v8）の動きの試験。BEHAVIOR.md の主要な動きを守る。
 * 行が出る・言葉で絞れる・札と並びが口へ渡る・閲覧のみは帯が出て作れない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listBroadcasts = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const createView = vi.hoisted(() => vi.fn(async () => ({ success: true, data: { id: 'new-view' } })))
const listViews = vi.hoisted(() => vi.fn())
const deleteBroadcast = vi.hoisted(() => vi.fn(async () => ({ success: true, data: null })))
const role = vi.hoisted(() => ({ current: 'owner' as string | null }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        list: listBroadcasts,
        delete: deleteBroadcast,
        getInsight: async () => ({ success: false }),
        savedViews: { ...actual.api.broadcasts.savedViews, list: listViews, create: createView },
      },
      folders: { ...actual.api.folders, list: listFolders },
      tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
      scenarios: { ...actual.api.scenarios, list: async () => ({ success: true, data: [] }) },
      dashboard: {
        ...actual.api.dashboard,
        overview: async () => ({ success: true, data: { delivery: { quotaLimit: 5000, quotaUsed: 1842 } } }),
      },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

const routerPush = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.current }
})

import BroadcastListV8 from './list'
import { flushListUrlState } from '@/components/shared/list-url-state'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

/* 試験の環境に localStorage が無いことがあるので、手で置く。 */
const store = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
  },
})

const base = {
  id: 'bc-1',
  title: '8月キャンペーンのお知らせ',
  messageType: 'text',
  messageContent: 'セールのご案内',
  targetType: 'all',
  targetTagId: null,
  status: 'scheduled',
  displayStatus: 'scheduled',
  displayStatusLabel: '予約済み',
  scheduledAt: '2026-08-24T01:00:00.000Z',
  sentAt: null,
  successCount: 0,
  folderId: null,
}
const rowB = { ...base, id: 'bc-2', title: '未購入者フォロー', messageContent: 'まだお買い物していない方へ', status: 'draft', displayStatus: 'draft', displayStatusLabel: '下書き', scheduledAt: null }

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  role.current = 'owner'
  store.clear()
  /* 広い板（1440）のふり。happy-dom は狭い板扱いになる。 */
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }),
  })
  listBroadcasts.mockImplementation(async () => ({
    success: true,
    data: [base, rowB],
    kpis: { scheduled: 4, thisMonth: 12, delivered: 1842, openRate: 69.4, drafts: 3 },
    statusCounts: { all: 24, scheduled: 4, draft: 3, pending_approval: 1, sent: 15, failed: 1 },
    pagination: { total: 2, limit: 20, cursor: 0, nextCursor: null },
  }))
  listFolders.mockImplementation(async () => ({ success: true, data: [], unfiledCount: 0 }))
  listViews.mockImplementation(async () => ({ success: true, data: [] }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
}

describe('V8 一斉配信一覧（src/v8）の動き', () => {
  it('行と数の帯・札の件数が出る', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(host.textContent).toContain('8月キャンペーンのお知らせ')
    expect(host.textContent).toContain('未購入者フォロー')
    expect(host.textContent).toContain('5,000 通のうち 1,842 通を使用')
    expect(buttonByText('すべて 24'), '札「すべて 24」がありません').toBeTruthy()
  })

  it('言葉で絞ると1件になる', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const search = host.querySelector('input[placeholder="タイトル・内容で探す"]') as HTMLInputElement
    expect(search, '探す欄がありません').toBeTruthy()
    fireEvent.change(search, { target: { value: '未購入' } })
    await flush()
    expect(host.textContent).not.toContain('8月キャンペーンのお知らせ')
    expect(host.textContent).toContain('未購入者フォロー')
  })

  it('札を押すと状態で、並びを押すと古い順で読み直す', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    act(() => { buttonByText('下書き 3')?.click() })
    await flush()
    expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({ displayStatus: 'draft', cursor: 0 }))
    act(() => { buttonByText('新しい順')?.click() })
    await flush()
    expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'oldest' }))
    expect(buttonByText('古い順'), '並びの字が入れ替わっていません').toBeTruthy()
  })

  it('編集キーの無い運用担当は閲覧のみの帯が出て、作る・保存・フォルダ追加のボタンを置かない', async () => {
    role.current = 'staff'
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(host.textContent).toContain('閲覧のみで見ています')
    const buttons = [...host.querySelectorAll('button')]
    // 押せない形で出すのではなく、置かない（2026-10-06 オーナー決定）
    expect(buttons.find((b) => b.textContent?.includes('配信を作る')), '閲覧のみに「配信を作る」が出ています').toBeUndefined()
    expect(buttons.find((b) => b.textContent?.includes('この条件を保存する')), '閲覧のみに「この条件を保存する」が出ています').toBeUndefined()
    expect(buttons.find((b) => b.textContent?.includes('フォルダを追加')), '閲覧のみに「フォルダを追加」が出ています').toBeUndefined()
  })

  it('編集キーを持つ運用担当は作れる', async () => {
    role.current = 'staff'
    window.localStorage.setItem('lh_staff_permissions', JSON.stringify(['broadcast.definition.edit']))
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(host.textContent).not.toContain('閲覧のみで見ています')
    const create = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('配信を作る')) as HTMLButtonElement
    expect(create.disabled).toBe(false)
  })

  it('配信を作る ▾ は絵（Xr6eu）の分け方：かんたんに送る・詳しく作る（説明つき）。詳しく作るは5つの手順へ移る', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const create = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('配信を作る')) as HTMLButtonElement
    act(() => { create.click() })
    await flush()
    const items = [...document.querySelectorAll('[role="menuitem"]')]
    const labels = items.map((item) => item.textContent ?? '')
    expect(labels[0]).toContain('かんたんに送る')
    expect(labels[0]).toContain('文字1通を、全員かタグで。1画面で送れる')
    expect(labels[1]).toContain('詳しく作る')
    expect(labels[1]).toContain('画像・カード・細かい絞り込み・承認（5つの手順）')
    routerPush.mockClear()
    act(() => { (items[1] as HTMLElement).click() })
    expect(routerPush).toHaveBeenCalledWith('/broadcasts/new')
  })

  it('下書きの削除は窓を出さずに行を外し、5秒は送らない。予約済みは今までどおり確かめの窓', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      deleteBroadcast.mockClear()
      // 前の試験の検索語（URL に置かれる）を外す。
      flushListUrlState()
      window.history.replaceState(null, '', '/broadcasts')
      act(() => { root.render(<BroadcastListV8 />) })
      await flush()
      const openMenuOf = (title: string) => {
        const row = [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(title))
        const trigger = row?.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
        act(() => { trigger.click() })
      }
      const clickMenuItem = (label: string) => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes(label)) as HTMLElement
        act(() => { item.click() })
      }
      openMenuOf('未購入者フォロー')
      clickMenuItem('削除する')
      await flush()
      expect(document.querySelector('[role="dialog"],[role="alertdialog"]'), '下書きなのに確かめの窓が出ました').toBeNull()
      expect([...host.querySelectorAll('tr')].some((tr) => tr.textContent?.includes('未購入者フォロー')), '行が外れていません').toBe(false)
      expect(deleteBroadcast).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(5100) })
      await flush()
      expect(deleteBroadcast).toHaveBeenCalledWith('bc-2')

      openMenuOf('8月キャンペーンのお知らせ')
      clickMenuItem('削除する')
      await flush()
      expect(document.body.textContent).toContain('を削除しますか？')
    } finally {
      vi.useRealTimers()
    }
  })
  it('統括から来た配信（提案 E-9・l3RQH）は「統括から」の札と鍵を出し、「…」は見る・複製だけ（編集・削除を出さない）', async () => {
    flushListUrlState()
    window.history.replaceState(null, '', '/broadcasts')
    const hqRow = { ...base, id: 'bc-hq', title: '1月の限定メニュー', fromHeadquarters: true, hqRunId: 'run-1', editable: false }
    listBroadcasts.mockImplementation(async () => ({
      success: true,
      data: [hqRow, rowB],
      kpis: { scheduled: 1, thisMonth: 2, delivered: 0, openRate: 0, drafts: 1 },
      statusCounts: { all: 2, scheduled: 1, draft: 1, pending_approval: 0, sent: 0, failed: 0 },
      pagination: { total: 2, limit: 20, cursor: 0, nextCursor: null },
    }))
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const rowOf = (title: string) => [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(title))
    expect(rowOf('1月の限定メニュー')?.textContent).toContain('統括から')
    expect(rowOf('未購入者フォロー')?.textContent).not.toContain('統括から')
    const trigger = rowOf('1月の限定メニュー')?.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
    act(() => { trigger.click() })
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())
    expect(labels).toContain('見る')
    expect(labels).toContain('複製')
    expect(labels.some((label) => label?.includes('削除'))).toBe(false)
    expect(labels.some((label) => label?.includes('編集'))).toBe(false)
    expect(labels.some((label) => label?.includes('フォルダへ移す'))).toBe(false)
  })
})

function resetUrl() {
  flushListUrlState()
  window.history.replaceState(null, '', '/broadcasts')
}
it('2ページ目を含む全配信を検索し、検索結果を20件ずつ表示する', async () => {
  resetUrl()
  const rows = Array.from({ length: 125 }, (_, i) => ({ ...rowB, id: `row-${i}`, title: i < 100 ? `通常${i}` : `検索対象${i}` }))
  listBroadcasts.mockImplementation(async (params) => {
    const cursor = Number(params.cursor ?? 0)
    const limit = params.limit ?? 20
    return { success: true, data: rows.slice(cursor, cursor + limit), pagination: { total: rows.length, nextCursor: cursor + limit < rows.length ? String(cursor + limit) : null } }
  })
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  fireEvent.change(host.querySelector('input[placeholder="タイトル・内容で探す"]')!, { target: { value: '検索対象' } })
  await flush()
  expect(host.textContent).toContain('検索対象100')
  expect(host.textContent).not.toContain('検索対象124')
  expect(host.textContent).toContain('25件中 1〜20件')
  const next = host.querySelector('button[aria-label="次のページ"]') as HTMLButtonElement
  expect(next).toBeTruthy()
  act(() => next.click())
  await flush()
  expect(host.textContent).toContain('検索対象124')
  expect(host.textContent).toContain('25件中 21〜25件')
  fireEvent.change(host.querySelector('input[placeholder="タイトル・内容で探す"]')!, { target: { value: '見つからない' } })
  await flush()
  expect(host.textContent).toContain('0件')
  fireEvent.change(host.querySelector('input[placeholder="タイトル・内容で探す"]')!, { target: { value: '' } })
  await flush()
  expect(host.textContent).toContain('通常0')
})
it('全件検索が上限を超えたら部分的な検索結果を表示しない', async () => {
  resetUrl()
  listBroadcasts.mockResolvedValue({ success: true, data: [rowB], pagination: { total: 10001, nextCursor: '100' } })
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  fireEvent.change(host.querySelector('input[placeholder="タイトル・内容で探す"]')!, { target: { value: '未購入' } })
  await flush()
  expect(host.textContent).toContain('10,000件')
  expect(host.querySelector('tbody')?.textContent ?? '').not.toContain('未購入者フォロー')
})
it('保存した検索の送信済み・表示件数・古い順も復元する', async () => {
  resetUrl()
  listViews.mockResolvedValue({ success: true, data: [{ id: 'v1', name: '前月の送信', filters: { statusFilter: 'sent' }, sortKey: 'oldest', pageSize: 50 }] })
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  act(() => { buttonByText('保存した検索')!.click() })
  await flush()
  act(() => { ([...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.includes('前月の送信')) as HTMLElement).click() })
  await flush()
  expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({ displayStatus: 'sent', limit: 50, sort: 'oldest', cursor: 0 }))
})
it('検索保存は現在の並び順と表示件数を保存する', async () => {
  resetUrl()
  createView.mockClear()
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  act(() => { buttonByText('新しい順')!.click(); buttonByText('この条件を保存する')!.click() })
  await flush()
  fireEvent.change(host.querySelector('input[aria-label="保存する検索の名前"]')!, { target: { value: '古い配信' } })
  act(() => { buttonByText('保存する')!.click() })
  await flush()
  expect(createView).toHaveBeenCalledWith('account-a', expect.objectContaining({ sortKey: 'oldest', pageSize: 20 }))
})
