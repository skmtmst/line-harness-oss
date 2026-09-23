// @vitest-environment happy-dom
/*
 * #641: 自動応答一覧の行操作を「枠つき編集ボタン＋削除アイコン＋・・・」へ統一。
 * 文字ボタン3個（編集・停止/再開・削除）をやめ、停止・再開は「その他」メニューへ
 * 集約したことを実マウントで確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listReplies = vi.hoisted(() => vi.fn())
const listTemplates = vi.hoisted(() => vi.fn())
const summary = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      autoReplies: { ...actual.api.autoReplies, list: listReplies, summary },
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
}))

import AutoRepliesPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const rule = {
  id: 'ar-1',
  name: '旧キーワードルール',
  keyword: '予約',
  matchType: 'contains',
  keywords: null,
  respondToAll: false,
  isActive: true,
  lifecycleStatus: 'published',
  hits: { period: 3, total: 10 },
  responseContent: 'ご予約を承ります',
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

beforeEach(() => {
  listReplies.mockImplementation(async () => ({ success: true, data: [rule] }))
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
})

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

describe('#641 自動応答一覧の行操作', () => {
  it('「編集」が枠つきボタン、削除はアイコン、停止は「・・・」メニューの中', async () => {
    await act(async () => { root.render(<AutoRepliesPage />) })
    await flush()

    const edit = [...host.querySelectorAll('button')]
      .find((el) => el.textContent?.trim() === '編集')
    expect(edit, '枠つき「編集」ボタンが見つかりません').toBeTruthy()

    const del = host.querySelector('button[aria-label="自動応答「旧キーワードルール」を削除"]')
    expect(del, '削除アイコンが見つかりません').toBeTruthy()

    const more = host.querySelector('button[aria-label="自動応答「旧キーワードルール」のその他操作"]') as HTMLButtonElement
    expect(more, 'その他ボタンが見つかりません').toBeTruthy()
    act(() => { more.click() })
    const menu = host.querySelector('[role="menu"]')
    expect(menu, 'メニューが開きません').toBeTruthy()
    expect(menu!.textContent).toContain('停止する')
  })

  it('下書き行には「その他」ボタンを出さない（公開の前段なので動かせない）', async () => {
    listReplies.mockImplementation(async () => ({
      success: true,
      data: [{ ...rule, isActive: false, lifecycleStatus: 'draft' }],
    }))
    await act(async () => { root.render(<AutoRepliesPage />) })
    await flush()
    expect(host.querySelector('button[aria-label="自動応答「旧キーワードルール」のその他操作"]')).toBeNull()
  })
})
