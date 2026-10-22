// @vitest-environment happy-dom
/*
 * R178: 「該当人数：すべて」は0人・1人以上・未集計の全件を出す。
 * 以前は数値の all が `count > 0` へ進み、0人の検索が初期一覧から消えて
 * 保存失敗と誤認されていた。0人・1人以上・未集計の混在で確かめる。
 */
import React, { act } from 'react'
import { fireEvent } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listSearches = vi.hoisted(() => vi.fn())
const reorderSearches = vi.hoisted(() => vi.fn(async () => ({ success: true })))

const items = [
  {
    id: 's-zero', name: 'QA_R28_NO_FRIEND相当の検索', scope: 'friends', conditions: { all: [] },
    createdBy: 'staff-1', lineAccountId: 'a1', isShared: false, displayOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z', matchCount: 0, usedIn: [], canDelete: true,
  },
  {
    id: 's-five', name: '5人いる検索', scope: 'friends', conditions: { all: [] },
    createdBy: 'staff-1', lineAccountId: 'a1', isShared: false, displayOrder: 1,
    createdAt: '2026-09-01T00:00:00.000Z', matchCount: 5, usedIn: [], canDelete: true,
  },
  {
    id: 's-unknown', name: '未集計の検索', scope: 'friends', conditions: { all: [] },
    createdBy: 'staff-1', lineAccountId: 'a1', isShared: false, displayOrder: 2,
    createdAt: '2026-09-01T00:00:00.000Z', matchCount: null, usedIn: [], canDelete: true,
  },
]

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      savedSearches: {
        ...actual.api.savedSearches,
        list: listSearches,
        reorder: reorderSearches,
      },
      tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
      supportMarks: { ...actual.api.supportMarks, list: async () => ({ success: true, data: [] }) },
      scenarios: { ...actual.api.scenarios, list: async () => ({ success: true, data: [] }) },
      friendFields: { ...actual.api.friendFields, list: async () => ({ success: true, data: [] }) },
      featureSettings: {
        ...actual.api.featureSettings,
        visibility: async () => ({ success: true, data: { features: {} } }),
      },
    },
  }
})

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a1', selectedAccount: { id: 'a1', name: '店舗A' } }),
}))

import SavedSearchList from '@/v8/tags/searches-tab'

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  window.history.replaceState(null, '', '/tags?tab=searches')
  listSearches.mockReset().mockResolvedValue({ success: true, items, summary: { total: 3, usedInBroadcasts: 0, zeroMatches: 1, callsThisMonth: 0 } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.restoreAllMocks()
})

function rowNames(): string[] {
  return Array.from(host.querySelectorAll('tbody tr')).map((row) => row.textContent ?? '')
}

describe('R178 該当人数の絞り込み', () => {
  it('「すべて」が0人・1人以上・未集計の全件を出す', async () => {
    await act(async () => {
      root.render(<SavedSearchList accountId="a1" canEdit />)
    })
    await flush()
    await flush()
    const names = rowNames().join('\n')
    expect(names).toContain('QA_R28_NO_FRIEND相当の検索')
    expect(names).toContain('5人いる検索')
    expect(names).toContain('未集計の検索')
    expect(host.textContent).toContain('3件')
  })
})

it('保存した検索を並べ替えた後の再取得でも、行を骨組みへ戻さない', async () => {
  await act(async () => root.render(<SavedSearchList accountId="a1" canEdit />))
  await flush()
  listSearches.mockImplementationOnce(() => new Promise(() => {}))
  const menu = host.querySelector<HTMLButtonElement>('button[aria-label="保存した検索「QA_R28_NO_FRIEND相当の検索」の操作"]')!
  await act(async () => fireEvent.click(menu))
  const down = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent?.includes('下へ動かす'))!
  await act(async () => fireEvent.click(down))
  await flush()
  expect(reorderSearches).toHaveBeenCalledWith('a1', ['s-five', 's-zero', 's-unknown'])
  expect([...host.querySelectorAll('tbody tr')].map(row => (row as HTMLElement).dataset.reorderId)).toEqual(['s-five', 's-zero', 's-unknown'])
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(host.textContent).toContain('3件')
})

it('保存した検索はアカウント切替中に前の行と該当人数を見せない', async () => {
  await act(async () => root.render(<SavedSearchList accountId="a1" canEdit />))
  await flush()
  listSearches.mockImplementationOnce(() => new Promise(() => {}))
  await act(async () => root.render(<SavedSearchList accountId="a2" canEdit />))
  expect(host.querySelectorAll('tbody tr')).toHaveLength(0)
  expect(host.textContent).not.toContain('5人いる検索')
})
