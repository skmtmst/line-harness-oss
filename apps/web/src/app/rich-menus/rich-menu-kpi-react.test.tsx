// @vitest-environment happy-dom

import React from 'react'
import { act, cleanup, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type ApiResult = { success: boolean; data?: unknown }

const fixture = vi.hoisted(() => ({
  selectedAccount: { id: 'account-a', name: 'A社' } as { id: string; name: string } | null,
  listPage: (accountId: string): Promise<ApiResult> => {
    void accountId
    return Promise.resolve({ success: true })
  },
  tapStats: (accountId: string): Promise<ApiResult> => {
    void accountId
    return Promise.resolve({ success: true })
  },
  external: (accountId: string): Promise<ApiResult> => {
    void accountId
    return Promise.resolve({ success: true })
  },
}))

const listResult = (total: number, published: number, targeting: number): ApiResult => ({
  success: true,
  data: {
    items: [],
    total,
    limit: 20,
    sort: [{ field: 'targeting_priority', direction: 'asc' }],
    facets: { total, published, targeting, folderCounts: {} },
  },
})

const tapResult = (total: number, top?: { label: string; taps: number }): ApiResult => ({
  success: true,
  data: {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
    total,
    byGroup: [],
    byArea: top
      ? [{ areaId: 'area-1', groupId: 'group-1', pageId: 'page-1', viaTrackedLink: 0, ...top }]
      : [],
  },
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccount: fixture.selectedAccount }),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500
  },
  api: {
    richMenuGroups: {
      listPage: (accountId: string) => fixture.listPage(accountId),
      external: (accountId: string) => fixture.external(accountId),
      tapStats: (accountId: string) => fixture.tapStats(accountId),
    },
    folders: {
      list: () => Promise.resolve({ success: true, data: [], unfiledCount: 0 }),
    },
  },
}))

beforeEach(() => {
  fixture.selectedAccount = { id: 'account-a', name: 'A社' }
  fixture.listPage = () => Promise.resolve(listResult(3, 2, 1))
  fixture.tapStats = () => Promise.resolve(tapResult(12, { label: '予約ボタン', taps: 7 }))
  fixture.external = () => Promise.resolve({
    success: true,
    data: { currentDefault: null, lineMenus: [] },
  })
})

afterEach(cleanup)

async function renderPage() {
  const { default: RichMenusListPage } = await import('./page')
  const rendered = render(<RichMenusListPage />)
  const kpis = rendered.container.querySelector<HTMLElement>('[data-design="KPIs"]')
  if (!kpis) throw new Error('KPI block is missing')
  return { ...rendered, RichMenusListPage, kpis }
}

describe('リッチメニュー一覧のKPI', () => {
  test('実取得した全体・公開中・タップ・最多・出し分けを見える位置に表示する', async () => {
    const { kpis } = await renderPage()

    await within(kpis).findByText('12')
    expect(kpis.hidden).toBe(false)
    expect(kpis.dataset.groupKpiState).toBe('ready')
    expect(within(kpis).queryByText('3')).toBeTruthy()
    expect(within(kpis).queryByText('公開中 2')).toBeTruthy()
    expect(within(kpis).queryByText('予約ボタン')).toBeTruthy()
    expect(within(kpis).queryByText('1')).toBeTruthy()
  })

  test('取得中は0と断定せず、読み込み中と表示する', async () => {
    fixture.listPage = () => new Promise(() => undefined)
    fixture.tapStats = () => new Promise(() => undefined)
    fixture.external = () => new Promise(() => undefined)
    const { kpis } = await renderPage()

    expect(kpis.hidden).toBe(false)
    expect(kpis.dataset.groupKpiState).toBe('loading')
    expect(within(kpis).getAllByText('読み込んでいます').length).toBeGreaterThan(0)
    expect(within(kpis).queryByText('0')).toBeNull()
  })

  test('取得できた0件・0回と取得失敗を言い分ける', async () => {
    fixture.listPage = () => Promise.resolve(listResult(0, 0, 0))
    fixture.tapStats = () => Promise.resolve(tapResult(0))
    const ready = await renderPage()
    await within(ready.kpis).findAllByText('0', {}, { timeout: 2_000 })
    expect(within(ready.kpis).getByText('公開中 0')).toBeTruthy()
    expect(within(ready.kpis).getByText('まだ押されていません')).toBeTruthy()
    ready.unmount()

    fixture.listPage = () => Promise.reject(new Error('list failed'))
    fixture.tapStats = () => Promise.reject(new Error('stats failed'))
    const failed = await renderPage()
    await within(failed.kpis).findAllByText('一覧を取得できませんでした')
    expect(within(failed.kpis).getAllByText('集計を取れませんでした')).toHaveLength(2)
    expect(within(failed.kpis).queryByText('0')).toBeNull()
  })

  test('アカウント切替後に遅れて届いた前アカウントのKPIを表示しない', async () => {
    let resolveAccountAList!: (value: ApiResult) => void
    let resolveAccountATaps!: (value: ApiResult) => void
    let resolveAccountAExternal!: (value: ApiResult) => void
    fixture.listPage = (accountId) => accountId === 'account-a'
      ? new Promise((resolve) => { resolveAccountAList = resolve })
      : Promise.resolve(listResult(8, 6, 4))
    fixture.tapStats = (accountId) => accountId === 'account-a'
      ? new Promise((resolve) => { resolveAccountATaps = resolve })
      : Promise.resolve(tapResult(80, { label: 'B社ボタン', taps: 50 }))
    fixture.external = (accountId) => accountId === 'account-a'
      ? new Promise((resolve) => { resolveAccountAExternal = resolve })
      : Promise.resolve({ success: true, data: { currentDefault: null, lineMenus: [] } })

    const { RichMenusListPage, rerender, kpis } = await renderPage()
    fixture.selectedAccount = { id: 'account-b', name: 'B社' }
    rerender(<RichMenusListPage />)
    await within(kpis).findByText('80')

    await act(async () => {
      resolveAccountAList(listResult(1, 1, 1))
      resolveAccountATaps(tapResult(10, { label: 'A社ボタン', taps: 10 }))
      resolveAccountAExternal({ success: true, data: { currentDefault: null, lineMenus: [] } })
    })

    expect(within(kpis).queryByText('A社ボタン')).toBeNull()
    expect(within(kpis).queryByText('B社ボタン')).toBeTruthy()
    expect(within(kpis).queryByText('80')).toBeTruthy()
  })
})
