// @vitest-environment happy-dom
/*
 * N-049: ドラッグだけだった並び替えをキーボードでも動かせることを、
 * 本物のReactで確かめる試験。
 *
 * 見るのは2つだけ:
 *   - つまみがフォーカスできるボタンで、↑/↓ で1つずつ動くこと
 *   - 動いた結果が既存の並び替えAPIへ「新しい並び」で届くこと
 *
 * 差し替えるのは api（サーバーとの境界）・next/link・next/navigation・
 * account-context だけ。見た目（ドラッグの挙動）は変えていない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  tagsReorder: vi.fn(),
  friendFieldsReorder: vi.fn(),
  supportMarksReorder: vi.fn(),
  savedSearchesReorder: vi.fn(),
  friendFieldsUpdate: vi.fn(),
  supportMarksUpdate: vi.fn(),
  savedSearchesUpdate: vi.fn(),
}))

const state = vi.hoisted(() => ({
  fields: [] as unknown[],
  marks: [] as unknown[],
  searches: [] as unknown[],
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: {
        ...actual.api.tags,
        list: async () => ({ success: true, data: [] }),
        reorder: calls.tagsReorder,
      },
      friendFields: {
        ...actual.api.friendFields,
        list: async () => ({ success: true, data: state.fields }),
        stats: async () => ({
          success: true,
          data: { total: state.fields.length, inUse: 0, registeredFriends: 0, formLinks: null, updatedThisMonth: 0 },
        }),
        update: calls.friendFieldsUpdate,
        reorder: calls.friendFieldsReorder,
      },
      supportMarks: {
        ...actual.api.supportMarks,
        list: async () => ({ success: true, data: state.marks }),
        update: calls.supportMarksUpdate,
        reorder: calls.supportMarksReorder,
      },
      savedSearches: {
        ...actual.api.savedSearches,
        list: async () => ({
          success: true,
          items: state.searches,
          data: state.searches,
          summary: { total: state.searches.length, usedInBroadcasts: 0, zeroMatches: 0, callsThisMonth: 0 },
          pagination: { total: state.searches.length, limit: 50, cursor: '', nextCursor: null },
        }),
        update: calls.savedSearchesUpdate,
        reorder: calls.savedSearchesReorder,
      },
      scenarios: {
        ...actual.api.scenarios,
        list: async () => ({ success: true, data: [] }),
      },
      // ListKpis が枠の数字を取りに行く口。型どおりの形で返す。
      listStats: {
        ...actual.api.listStats,
        get: async () => ({
          success: true,
          data: {
            tags: { total: 0, unused: 0, taggedFriends: 0, assignedThisMonth: 0 },
            marks: { total: 0, inUse: 0, unanswered: 0, inProgress: 0, onHold: 0, resolved: 0, changedLast7: 0 },
            searches: { total: 0, limit: 50 },
            templates: { total: 0, inUse: 0, sentThisMonth: 0, unused90d: 0, clickRate: null },
            scenarios: { total: 0, active: 0, subscribers: 0, completed: 0, sentThisWeek: 0 },
            reminders: { total: 0, active: 0, waiting: 0, sentThisMonth: 0 },
          },
        }),
      },
      featureSettings: {
        ...actual.api.featureSettings,
        visibility: async () => ({ success: true, data: { features: {} } }),
      },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a1', selectedAccount: { id: 'a1', name: '店舗A' } }),
}))

import TagsPageV4 from './tags-page-v4'
import FriendFieldList from './field-list'
import SupportMarkList from './mark-list'
import SavedSearchList from './saved-search-list'

let host: HTMLDivElement
let root: Root

const tags = [
  { id: 't1', name: 'タグA', color: '#9ca3af', createdAt: '2026-09-01T00:00:00+09:00', lineAccountId: 'a1', version: 1, isStarred: false },
  { id: 't2', name: 'タグB', color: '#9ca3af', createdAt: '2026-09-01T00:00:00+09:00', lineAccountId: 'a1', version: 1, isStarred: false },
  { id: 't3', name: 'タグC', color: '#9ca3af', createdAt: '2026-09-01T00:00:00+09:00', lineAccountId: 'a1', version: 1, isStarred: false },
]

const field = (id: string, name: string, order: number) => ({
  id,
  folderId: null,
  name,
  fieldKey: id,
  type: 'text' as const,
  options: null,
  defaultValue: null,
  source: 'manual' as const,
  ecFieldPath: null,
  ecIsMaster: false,
  isPersonal: false,
  isStarred: false,
  displayOrder: order,
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01',
  usageCount: 0,
})

const mark = (id: string, name: string, order: number) => ({
  id,
  name,
  color: '#EC4899',
  isDefault: false,
  autoOnInbound: false,
  displayOrder: order,
  createdAt: '2026-09-01',
  friendCount: 0,
  automationRules: [],
})

const search = (id: string, name: string, order: number) => ({
  id,
  name,
  scope: 'friends' as const,
  conditions: { all: [] },
  createdBy: 'staff-1',
  lineAccountId: 'a1',
  isShared: false,
  displayOrder: order,
  createdAt: '2026-09-01T00:00:00.000Z',
})

function grip(name: string): HTMLButtonElement {
  const el = host.querySelector(`button[aria-label="${name}を並び替え。上下キーで移動"]`)
  if (!el) throw new Error(`「${name}」の並び替えつまみが見つかりません`)
  return el as HTMLButtonElement
}

async function press(element: Element, key: 'ArrowUp' | 'ArrowDown') {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    // 並び替えAPIの往復と再読み込みを待つ
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  calls.tagsReorder.mockResolvedValue({ success: true })
  calls.friendFieldsReorder.mockResolvedValue({ success: true, data: { updated: 3 } })
  calls.supportMarksReorder.mockResolvedValue({ success: true, data: { updated: 3 } })
  calls.savedSearchesReorder.mockResolvedValue({ success: true, data: { updated: 3 } })
  calls.friendFieldsUpdate.mockResolvedValue({ success: true })
  calls.supportMarksUpdate.mockResolvedValue({ success: true })
  calls.savedSearchesUpdate.mockResolvedValue({ success: true })
  state.fields = [field('ff-1', '項目A', 0), field('ff-2', '項目B', 1), field('ff-3', '項目C', 2)]
  state.marks = [mark('m1', 'マークA', 0), mark('m2', 'マークB', 1), mark('m3', 'マークC', 2)]
  state.searches = [search('s1', '検索A', 0), search('s2', '検索B', 1), search('s3', '検索C', 2)]
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
})

describe('N-049 キーボードだけで並び替えられる', () => {
  it('タグ一覧: ↓で1つ下へ動き、新しい並びを reorder API へ送る', async () => {
    await render(React.createElement(TagsPageV4, { fixture: { items: tags, groups: [] } }))
    await press(grip('タグA'), 'ArrowDown')
    expect(calls.tagsReorder).toHaveBeenCalledWith(['t2', 't1', 't3'])
  })

  it('タグ一覧: 先頭で↑を押しても何も送らない', async () => {
    await render(React.createElement(TagsPageV4, { fixture: { items: tags, groups: [] } }))
    await press(grip('タグA'), 'ArrowUp')
    expect(calls.tagsReorder).not.toHaveBeenCalled()
  })

  /*
    #1014 ATTR-02/03/04: 並び替えは行ごとのPATCHではなく、
    「動かせる行だけの新しい順」を1回の reorder で送る。
    途中失敗の半端な順位と、共有マークへの複製を防ぐ。
  */
  it('友だち情報欄: ↑で1つ上へ動き、新しい並びを reorder API へ1回で送る', async () => {
    await render(React.createElement(FriendFieldList, { accountId: 'a1' }))
    await press(grip('項目B'), 'ArrowUp')
    expect(calls.friendFieldsReorder).toHaveBeenCalledTimes(1)
    expect(calls.friendFieldsReorder).toHaveBeenCalledWith('a1', ['ff-2', 'ff-1', 'ff-3'])
    expect(calls.friendFieldsUpdate).not.toHaveBeenCalled()
  })

  it('対応マーク: ↓で1つ下へ動き、新しい並びを reorder API へ1回で送る', async () => {
    await render(React.createElement(SupportMarkList, { accountId: 'a1' }))
    await press(grip('マークA'), 'ArrowDown')
    expect(calls.supportMarksReorder).toHaveBeenCalledTimes(1)
    expect(calls.supportMarksReorder).toHaveBeenCalledWith('a1', ['m2', 'm1', 'm3'])
    expect(calls.supportMarksUpdate).not.toHaveBeenCalled()
  })

  it('保存した検索: ↑で1つ上へ動き、新しい並びを reorder API へ1回で送る', async () => {
    await render(React.createElement(SavedSearchList, { accountId: 'a1' }))
    await press(grip('検索B'), 'ArrowUp')
    expect(calls.savedSearchesReorder).toHaveBeenCalledTimes(1)
    expect(calls.savedSearchesReorder).toHaveBeenCalledWith('a1', ['s2', 's1', 's3'])
    expect(calls.savedSearchesUpdate).not.toHaveBeenCalled()
  })

  it('対応マーク: 共有マークは reorder の対象に入れない（#1014 ATTR-04）', async () => {
    state.marks = [
      mark('m1', 'マークA', 0),
      mark('m2', 'マークB', 1),
      { ...mark('m3', '共有マーク', 2), isInherited: true },
    ]
    await render(React.createElement(SupportMarkList, { accountId: 'a1' }))
    await press(grip('マークA'), 'ArrowDown')
    // 末尾の共有マークは位置が固定なので送らない。動かせる2件だけの新しい順。
    expect(calls.supportMarksReorder).toHaveBeenCalledWith('a1', ['m2', 'm1'])
    expect(calls.supportMarksUpdate).not.toHaveBeenCalled()
  })

  it('対応マーク: 共有マークの位置へは動かさず、理由を残す（#1014 ATTR-04）', async () => {
    state.marks = [
      mark('m1', 'マークA', 0),
      { ...mark('m2', '共有マーク', 1), isInherited: true },
      mark('m3', 'マークC', 2),
    ]
    await render(React.createElement(SupportMarkList, { accountId: 'a1' }))
    await press(grip('マークA'), 'ArrowDown')
    // 共有マークに向かう移動は止める。送られないので複製も起きない。
    expect(calls.supportMarksReorder).not.toHaveBeenCalled()
    expect(host.textContent).toContain('共有マーク')
  })

  it('保存に失敗したら元の並びへ戻し、失敗を残したまま再読込しない（#1014 ATTR-02）', async () => {
    calls.friendFieldsReorder.mockResolvedValueOnce({ success: false, error: 'conflict' })
    await render(React.createElement(FriendFieldList, { accountId: 'a1' }))
    await press(grip('項目B'), 'ArrowUp')
    // 失敗のあとも項目Bは元の位置（2番目）のまま表示されている。
    // 狭幅カードと表で同じ項目が2度出るため、表の側だけを見る。
    const table = host.querySelector('table')!
    const names = Array.from(table.querySelectorAll('a[href*="/tags/fields/edit?id="]')).map((el) => el.textContent)
    expect(names).toEqual(['項目A', '項目B', '項目C'])
    expect(host.textContent).toContain('並び順を保存できませんでした')
  })

  it('つまみは説明付きのボタンとして出る（マウス専用の印ではない）', async () => {
    await render(React.createElement(TagsPageV4, { fixture: { items: tags, groups: [] } }))
    const el = grip('タグA')
    expect(el.tagName).toBe('BUTTON')
    expect(el.tabIndex).not.toBe(-1)
  })
})
