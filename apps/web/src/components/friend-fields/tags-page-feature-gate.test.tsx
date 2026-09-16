// @vitest-environment happy-dom
/*
 * 友だち属性3機能のタブ閉塞(#861)を本物のReactで動かす試験。
 *
 * 見るのは4つだけ: offのタブが出ないこと、直URL（?tab=）でも無効画面に
 * なること、機能が残っているタブはそのまま出ること、読み込み失敗は
 * fail-closed になること。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  features: { friend_fields: true, support_marks: true, saved_searches: true } as Record<string, boolean> | undefined,
  search: '',
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      featureSettings: {
        ...actual.api.featureSettings,
        visibility: vi.fn(async () =>
          state.features === undefined
            ? { success: false as const, error: 'unavailable' }
            : { success: true as const, data: { features: state.features } },
        ),
      },
      tags: {
        ...actual.api.tags,
        list: vi.fn(async () => ({ success: true as const, data: [] })),
      },
      tagGroups: {
        ...actual.api.tagGroups,
        list: vi.fn(async () => ({ success: true as const, data: [] })),
      },
      listStats: {
        ...actual.api.listStats,
        get: vi.fn(async () => ({ success: false as const, error: 'unused' })),
      },
      friendFields: {
        ...actual.api.friendFields,
        list: vi.fn(async () => ({ success: true as const, data: [] })),
        stats: vi.fn(async () => ({ success: false as const, error: 'unused' })),
      },
      supportMarks: {
        ...actual.api.supportMarks,
        list: vi.fn(async () => ({ success: true as const, data: [] })),
      },
      savedSearches: {
        ...actual.api.savedSearches,
        list: vi.fn(async () => ({ success: true as const, data: { items: [], total: 0 } })),
      },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(state.search),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', selectedAccount: null }),
}))

import TagsPageV4 from './tags-page-v4'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function render() {
  await act(async () => {
    root.render(React.createElement(TagsPageV4, { accountId: 'account-1' }))
  })
  // visibility 応答まで待つ
  await act(async () => {})
  await act(async () => {})
}

function tabLabels(): string[] {
  return Array.from(host.querySelectorAll('[data-design="GroupTabs"] button, [data-design="GroupTabs"] a, [data-design="GroupTabs"] [role="tab"]'))
    .map((el) => el.textContent?.trim() ?? '')
}

describe('/tags のタブが機能設定に従う(#861)', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    state.features = { friend_fields: true, support_marks: true, saved_searches: true }
    state.search = ''
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('全部onなら4タブが出る', async () => {
    await render()
    const labels = tabLabels()
    expect(labels).toContain('タグ')
    expect(labels).toContain('友だち情報欄')
    expect(labels).toContain('対応マーク')
    expect(labels).toContain('保存した検索')
  })

  it('support_marksだけoffなら対応マークのタブだけ消える', async () => {
    state.features = { friend_fields: true, support_marks: false, saved_searches: true }
    await render()
    const labels = tabLabels()
    expect(labels).not.toContain('対応マーク')
    expect(labels).toContain('タグ')
    expect(labels).toContain('友だち情報欄')
    expect(labels).toContain('保存した検索')
  })

  it('offのタブへ直URLで来ると本文ではなく無効画面を出す', async () => {
    state.features = { friend_fields: true, support_marks: false, saved_searches: true }
    state.search = 'tab=marks'
    await render()
    expect(host.textContent).toContain('この機能は設定でオフになっています')
    expect(host.querySelector('[data-feature-disabled]')?.getAttribute('data-feature-disabled')).toBe('support_marks')
  })

  it('saved_searchesがoffなら保存した検索タブが消え、直URLも無効画面', async () => {
    state.features = { friend_fields: true, support_marks: true, saved_searches: false }
    state.search = 'tab=searches'
    await render()
    expect(tabLabels()).not.toContain('保存した検索')
    expect(host.textContent).toContain('この機能は設定でオフになっています')
  })

  it('visibilityが取れないときは任意タブを隠し、タグだけ残す(fail-closed)', async () => {
    state.features = undefined
    await render()
    const labels = tabLabels()
    expect(labels).toContain('タグ')
    expect(labels).not.toContain('対応マーク')
    expect(labels).not.toContain('友だち情報欄')
    expect(labels).not.toContain('保存した検索')
  })
})
