// @vitest-environment happy-dom
/*
 * V8 一斉配信一覧（src/v8）の動きの試験。BEHAVIOR.md の主要な動きを守る。
 * 行が出る・言葉で絞れる・札と並びが口へ渡る・閲覧のみは帯が出て作るボタンを出さない。
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
const listViews = vi.hoisted(() => vi.fn())
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
        getInsight: async () => ({ success: false }),
        savedViews: { ...actual.api.broadcasts.savedViews, list: listViews },
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
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

  // 2026-10-06 オーナー決定：閲覧のみには押せないボタンを置かずに隠す（帯は出す）。
  it('編集キーの無い運用担当は閲覧のみの帯が出て、作るは出さない', async () => {
    role.current = 'staff'
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(host.textContent).toContain('閲覧のみで見ています')
    const create = [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('配信を作る'))
    expect(create).toHaveLength(0)
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
})
