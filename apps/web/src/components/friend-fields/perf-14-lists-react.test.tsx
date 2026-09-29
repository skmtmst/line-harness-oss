// @vitest-environment happy-dom
/*
 * #1017 PERF-14: 一覧と補助取得（集計・名前解決）を別々に反映する試験。
 *
 * 以前は
 *   - 友だち情報欄: Promise.all で一覧と集計を束ね、集計が遅い/失敗すると
 *     一覧まで待ち・一覧まで取得失敗になった。
 *   - 保存した検索: allSettled が5系統すべての完了を待ってから一覧を出し、
 *     遅い名前解決が一覧の表示を止めていた。
 *
 * ここで確かめるのは「一覧の応答だけ届いた時点で一覧が出る」ことと、
 * 「補助が失敗しても一覧は残り、カードは理由を添える」こと。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  fieldsStats: vi.fn(),
  tagsList: vi.fn(),
  marksList: vi.fn(),
  scenariosList: vi.fn(),
  fieldsListSupplement: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      friendFields: {
        ...actual.api.friendFields,
        list: async () => ({
          success: true,
          data: [{
            id: 'ff-1', folderId: null, name: '項目A', fieldKey: 'ff-1', type: 'text',
            options: null, defaultValue: null, source: 'manual', ecFieldPath: null,
            ecIsMaster: false, isPersonal: false, isStarred: false, displayOrder: 0,
            createdAt: '2026-09-01', updatedAt: '2026-09-01', usageCount: 0,
          }],
        }),
        stats: calls.fieldsStats,
      },
      savedSearches: {
        ...actual.api.savedSearches,
        list: async () => ({
          success: true,
          items: [{
            id: 's1', name: '検索A', scope: 'friends', conditions: { all: [] },
            createdBy: 'staff-1', lineAccountId: 'a1', isShared: false, displayOrder: 0,
            createdAt: '2026-09-01T00:00:00.000Z',
          }],
          summary: { total: 1, usedInBroadcasts: 0, zeroMatches: 0, callsThisMonth: 0 },
          pagination: { total: 1, limit: 50, cursor: '', nextCursor: null },
        }),
      },
      tags: { ...actual.api.tags, list: calls.tagsList },
      supportMarks: { ...actual.api.supportMarks, list: calls.marksList },
      scenarios: { ...actual.api.scenarios, list: calls.scenariosList },
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

import FriendFieldList from './field-list'
import SavedSearchList from './saved-search-list'

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node)
  })
  await flush()
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  calls.tagsList.mockResolvedValue({ success: true, data: [] })
  calls.marksList.mockResolvedValue({ success: true, data: [] })
  calls.scenariosList.mockResolvedValue({ success: true, data: [] })
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

describe('PERF-14: 一覧は補助取得を待たない', () => {
  it('友だち情報欄: 集計がまだ返っていなくても一覧は出る', async () => {
    const stats = deferred<unknown>()
    calls.fieldsStats.mockReturnValue(stats.promise)
    await render(React.createElement(FriendFieldList, { accountId: 'a1' }))
    // 集計は未着だが、一覧の行はもう見えている。
    expect(host.textContent).toContain('項目A')
    expect(host.textContent).not.toContain('読み込めませんでした')
    // あとから届いた集計はカードへ入る。
    stats.resolve({ success: true, data: { total: 1, inUse: 1, registeredFriends: 5, formLinks: null, updatedThisMonth: 2 } })
    await flush()
    expect(host.textContent).toContain('使用中 1件')
  })

  it('友だち情報欄: 集計が失敗しても一覧は残り、カードは理由を添える', async () => {
    calls.fieldsStats.mockRejectedValue(new Error('stats down'))
    await render(React.createElement(FriendFieldList, { accountId: 'a1' }))
    expect(host.textContent).toContain('項目A')
    expect(host.textContent).toContain('読み込めませんでした')
    // 一覧の行が消えてエラー表示に差し替わっていない。
    expect(host.querySelector('a[href*="/tags/fields/edit?id="]')).not.toBeNull()
  })

  it('保存した検索: 名前解決がまだ返っていなくても一覧は出る', async () => {
    const tags = deferred<unknown>()
    const marks = deferred<unknown>()
    const scenarios = deferred<unknown>()
    calls.tagsList.mockReturnValue(tags.promise)
    calls.marksList.mockReturnValue(marks.promise)
    calls.scenariosList.mockReturnValue(scenarios.promise)
    await render(React.createElement(SavedSearchList, { accountId: 'a1' }))
    expect(host.textContent).toContain('検索A')
    expect(host.textContent).not.toContain('保存した検索を読み込めませんでした')
    tags.resolve({ success: true, data: [] })
    marks.resolve({ success: true, data: [] })
    scenarios.resolve({ success: true, data: [] })
    await flush()
    expect(host.textContent).toContain('検索A')
  })
})
