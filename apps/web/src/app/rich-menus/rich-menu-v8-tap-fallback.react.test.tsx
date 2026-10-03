// @vitest-environment happy-dom

import React from 'react'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type ApiResult = { success: boolean; data?: unknown }

const fixture = vi.hoisted(() => ({
  selectedAccount: { id: 'account-a', name: 'A社' } as { id: string; name: string } | null,
  listPage: (): Promise<ApiResult> => Promise.resolve({ success: true }),
  tapStats: (): Promise<ApiResult> => Promise.resolve({ success: true }),
}))

const groupItem = (id: string, name: string, monthlyStats?: { taps: number }) => ({
  id,
  accountId: 'account-a',
  name,
  chatBarText: 'メニュー',
  size: 'large',
  defaultPageId: null,
  isDefaultForAll: false,
  status: 'published',
  publishingAt: null,
  targetingCondition: null,
  targetingPriority: 0,
  targetingEnabled: false,
  folderId: null,
  displayOrder: 0,
  defaultOpen: false,
  thumbnailR2Key: null,
  updatedAt: '2026-09-20T00:00:00.000Z',
  ...(monthlyStats ? { monthlyStats: { from: '2026-09-01', to: '2026-10-01', taps: monthlyStats.taps, uniqueAudience: { value: null, state: 'none' } } } : {}),
})

const listResult = (items: unknown[]): ApiResult => ({
  success: true,
  data: {
    items,
    total: items.length,
    limit: 20,
    sort: [{ field: 'targeting_priority', direction: 'asc' }],
    facets: { total: items.length, published: items.length, targeting: 0, folderCounts: {} },
  },
})

const tapResult = (byGroup: { groupId: string; taps: number }[]): ApiResult => ({
  success: true,
  data: {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
    total: byGroup.reduce((sum, row) => sum + row.taps, 0),
    byGroup,
    byArea: [],
  },
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccount: fixture.selectedAccount }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500
  },
  api: {
    richMenuGroups: {
      listPage: () => fixture.listPage(),
      external: () => Promise.resolve({ success: true, data: { currentDefault: null, lineMenus: [] } }),
      tapStats: () => fixture.tapStats(),
    },
    folders: {
      list: () => Promise.resolve({ success: true, data: [], unfiledCount: 0 }),
    },
  },
}))

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  fixture.selectedAccount = { id: 'account-a', name: 'A社' }
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

async function renderV8List() {
  const { default: RichMenusListPage } = await import('./page')
  return render(<RichMenusListPage />)
}

describe('リッチメニューV8一覧のタップ数', () => {
  test('月の集計が無い行は期間の集計で補う（v7と同じ）', async () => {
    fixture.listPage = () => Promise.resolve(listResult([groupItem('g1', '秋メニュー')]))
    fixture.tapStats = () => Promise.resolve(tapResult([{ groupId: 'g1', taps: 7 }]))
    const rendered = await renderV8List()
    const row = await rendered.findByText('秋メニュー')
    const tableRow = row.closest('tr') ?? row.closest('[role="row"]') ?? rendered.container
    expect(within(tableRow as HTMLElement).getByText('7回')).toBeTruthy()
  })

  test('更新日列とボタンの文言を行に出す（v7と同じ情報）', async () => {
    fixture.listPage = () => Promise.resolve(listResult([groupItem('g5', '春メニュー')]))
    fixture.tapStats = () => Promise.resolve(tapResult([]))
    const rendered = await renderV8List()
    const row = await rendered.findByText('春メニュー')
    const tableRow = row.closest('tr') ?? row.closest('[role="row"]') ?? rendered.container
    expect((tableRow as HTMLElement).textContent).toContain('ボタン「メニュー」')
    expect((tableRow as HTMLElement).textContent).toContain('9月20日')
  })

  test('集計自体が取れなければ「—」のままにする', async () => {
    fixture.listPage = () => Promise.resolve(listResult([groupItem('g9', '冬メニュー')]))
    fixture.tapStats = () => Promise.reject(new Error('stats failed'))
    const rendered = await renderV8List()
    const row = await rendered.findByText('冬メニュー')
    const tableRow = row.closest('tr') ?? row.closest('[role="row"]') ?? rendered.container
    const countMain = (tableRow as HTMLElement).querySelector('[class*="countMain"]')
    expect(countMain?.textContent).toBe('—')
  })
})
