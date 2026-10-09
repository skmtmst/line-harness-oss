// @vitest-environment happy-dom
/*
 * V8 自動応答一覧（src/v8）の動きの試験。BEHAVIOR.md の主要な動きを守る。
 * 行が出る・言葉で絞れる・止める窓が開く・選ぶとまとめ帯が出る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listReplies = vi.hoisted(() => vi.fn())
const listTemplates = vi.hoisted(() => vi.fn())
const summary = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const updateRule = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      autoReplies: { ...actual.api.autoReplies, list: listReplies, summary, update: updateRule },
      templates: { ...actual.api.templates, list: listTemplates },
      folders: { ...actual.api.folders, list: listFolders },
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
  return { ...actual, useStaffRole: () => 'owner', canManageRole: () => true }
})

import AutoRepliesListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const ruleA = {
  id: 'ar-1',
  name: '営業時間外の自動返信',
  keyword: '営業時間',
  matchType: 'contains',
  keywords: null,
  respondToAll: false,
  isActive: true,
  lifecycleStatus: 'published',
  hits: { period: 5, total: 20 },
  responseContent: '営業時間外です',
  responseType: 'text',
  keywordMatchMode: 'any',
  activeFrom: null,
  activeUntil: null,
  responseWeekdays: null,
  responseHolidayRule: null,
  cooldownMinutes: null,
  skipWhenOperatorActive: false,
  oncePerFriend: false,
  messageKinds: null,
  friendConditions: null,
  folderId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

const ruleB = { ...ruleA, id: 'ar-2', name: '予約変更のお問い合わせ', keyword: '予約', responseContent: 'ご予約を承ります', isActive: false, lifecycleStatus: 'stopped' }

beforeEach(() => {
  window.history.replaceState(null, '', '/auto-replies')
  document.documentElement.dataset.theme = 'v8'
  listReplies.mockImplementation(async () => ({ success: true, data: [ruleA, ruleB] }))
  listTemplates.mockImplementation(async () => ({ success: true, data: [] }))
  summary.mockImplementation(async () => ({ success: true, data: { conflictCount: 0 } }))
  listFolders.mockImplementation(async () => ({ success: true, data: [], unfiledCount: 0 }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

/* 広い板のふり（happy-dom は狭い板扱いで選ぶ箱・つまみが出ない）。 */
function stubWideViewport() {
  const real = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }),
    configurable: true,
  })
  return () => {
    Object.defineProperty(window, 'matchMedia', { value: real, configurable: true })
  }
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

describe('V8 自動応答一覧（src/v8）の動き', () => {
  it('行が2件出る', async () => {
    act(() => { root.render(<AutoRepliesListV8 />) })
    await flush()
    expect(host.textContent).toContain('営業時間外の自動返信')
    expect(host.textContent).toContain('予約変更のお問い合わせ')
  })

  it('言葉で絞ると1件になる', async () => {
    act(() => { root.render(<AutoRepliesListV8 />) })
    await flush()
    const search = host.querySelector('input[placeholder="ルール名・言葉で探す"]') as HTMLInputElement
    expect(search, '探す欄がありません').toBeTruthy()
    fireEvent.change(search, { target: { value: '営業時間' } })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) })
    await flush()
    expect(host.textContent).toContain('営業時間外の自動返信')
    expect(host.textContent).not.toContain('予約変更のお問い合わせ')
  })

  it('選ぶとまとめ帯が出る', async () => {
    const restore = stubWideViewport()
    try {
      act(() => { root.render(<AutoRepliesListV8 />) })
      await flush()
      const checkbox = host.querySelector('input[type="checkbox"][aria-label="営業時間外の自動返信を選択"]') as HTMLInputElement
      expect(checkbox, '行の選択肢がありません').toBeTruthy()
      act(() => { checkbox.click() })
      await flush()
      expect(host.textContent).toContain('1件を選択中')
      expect(host.textContent).toContain('まとめて止める')
    } finally {
      restore()
    }
  })
})

it('WEB083: 4番目を先頭へドラッグして保存後もD,A,B,Cになる', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const restore = stubWideViewport()
  let stored = ['A', 'B', 'C', 'D'].map((id, priority) => ({ ...ruleA, id, name: id, priority, lineAccountId: 'account-a' }))
  listReplies.mockImplementation(async () => ({ success: true, data: stored }))
  updateRule.mockImplementation(async (id: string, patch: { priority: number }) => {
    stored = stored.map(r => r.id === id ? { ...r, ...patch } : r)
    return { success: true }
  })
  try {
    act(() => { root.render(<AutoRepliesListV8 />) }); await flush()
    const from = host.querySelector<HTMLElement>('[data-reorder-id="D"] [data-reorder-handle]')!
    const to = host.querySelector<HTMLElement>('[data-reorder-id="A"]')!
    expect(from).toBeTruthy()
    act(() => { fireEvent.dragStart(from) }); act(() => { fireEvent.drop(to) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) }); await flush()
    expect([...stored].sort((a,b) => a.priority - b.priority).map(r => r.id)).toEqual(['D', 'A', 'B', 'C'])
    expect(new Set(stored.map(r => r.priority)).size).toBe(4)
  } finally { restore(); vi.useRealTimers() }
})

it('取得失敗を空の一覧にせず、その場で読み直すとルールが戻る', async () => {
  listReplies.mockResolvedValueOnce({ success: false, error: '通信に失敗しました' })
  act(() => { root.render(<AutoRepliesListV8 />) })
  await flush()
  expect(host.textContent).not.toContain('まだ自動応答のルールはありません')
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === 'もう一度読み込む')
  expect(retry).toBeTruthy()
  const calls = listReplies.mock.calls.length
  act(() => { retry!.click() })
  await flush()
  expect(listReplies.mock.calls.length).toBe(calls + 1)
  expect(host.textContent).toContain('営業時間外の自動返信')
  expect([...host.querySelectorAll('button')].some(button => button.textContent === 'もう一度読み込む')).toBe(false)
})

it('取得に成功して0件だったときだけ、空の一覧を出す', async () => {
  listReplies.mockResolvedValue({ success: true, data: [] })
  act(() => { root.render(<AutoRepliesListV8 />) })
  await flush()
  expect(host.textContent).toContain('まだ自動応答のルールはありません')
  expect([...host.querySelectorAll('button')].some(button => button.textContent === 'もう一度読み込む')).toBe(false)
})
