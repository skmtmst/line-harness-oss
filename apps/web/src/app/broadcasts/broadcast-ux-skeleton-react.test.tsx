// @vitest-environment happy-dom
/*
 * 配信 V8 の骨組み（サクサク感 A）。
 * 読み始め0.3秒は場所だけ取り、超えたら見出し付き5行の骨組みを出す。
 * 「読み込み中」の文言は出さない（読み上げ用の aria-label は残す）。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  broadcastsList: vi.fn(),
  broadcastsGetInsight: vi.fn(),
  broadcastsUpdate: vi.fn(),
  savedViewsList: vi.fn(),
  foldersList: vi.fn(),
  tagsList: vi.fn(),
  scenariosList: vi.fn(),
  dashboardOverview: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error { status?: number },
  api: {
    broadcasts: {
      list: apiMock.broadcastsList,
      getInsight: apiMock.broadcastsGetInsight,
      update: apiMock.broadcastsUpdate,
      savedViews: { list: apiMock.savedViewsList },
    },
    folders: { list: apiMock.foldersList },
    tags: { list: apiMock.tagsList },
    scenarios: { list: apiMock.scenariosList },
    dashboard: { overview: apiMock.dashboardOverview },
  },
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: 'テスト店' } }),
}))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
vi.mock('@/lib/staff-capability', () => ({ canEditFeature: () => true }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {}, usePageTitle: () => {} }))
vi.mock('@/components/broadcasts/broadcast-form', () => ({ default: () => null }))
vi.mock('@/components/shared/folder-add-dialog', () => ({ default: () => null }))
vi.mock('@/components/shared/confirm-dialog', () => ({ default: () => null }))

import BroadcastListV8 from './list-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  apiMock.broadcastsList.mockReturnValue(new Promise(() => {}))
  apiMock.broadcastsGetInsight.mockReturnValue(new Promise(() => {}))
  apiMock.savedViewsList.mockResolvedValue({ success: true, data: [] })
  apiMock.foldersList.mockResolvedValue({ success: true, data: [] })
  apiMock.tagsList.mockResolvedValue({ success: true, data: [] })
  apiMock.scenariosList.mockResolvedValue({ success: true, data: [] })
  apiMock.dashboardOverview.mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const BROADCAST = {
  id: 'b1',
  title: '新作の案内',
  messageType: 'text',
  messageContent: '本文',
  status: 'draft',
  displayStatus: 'draft',
  folderId: null,
  version: 3,
  targetType: 'all',
  insightSummary: null,
}

describe('配信一覧V8の骨組み', () => {
  it('0.3秒を超えたら見出し付き5行の骨組みを出す', async () => {
    render(<BroadcastListV8 />)
    await flush()
    /* 読み始め直後は骨組みを出さない（場所だけ取る）。 */
    expect(document.querySelector('[data-skeleton]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy?.getAttribute('aria-label')).toContain('一斉配信を読み込んでいます')
    const table = busy?.querySelector('table')
    expect(table?.querySelectorAll('thead th').length).toBe(6)
    expect(table?.querySelectorAll('tbody tr').length).toBe(5)
    expect(busy?.querySelector('[data-skeleton]'), '骨組みがある').toBeTruthy()
    expect(document.body.textContent).not.toContain('読み込み中')
  })

  it('フォルダへ移すは押した瞬間に裏で保存する', async () => {
    apiMock.broadcastsList.mockResolvedValue({
      success: true,
      data: [BROADCAST],
      kpis: null,
      statusCounts: null,
      pagination: { total: 1 },
    })
    apiMock.foldersList.mockResolvedValue({
      success: true,
      data: [{ id: 'f1', name: '販促', itemCount: 1, color: null }],
      unfiledCount: 1,
    })
    apiMock.broadcastsUpdate.mockResolvedValue({ success: true, data: {} })
    render(<BroadcastListV8 />)
    /* 一覧とフォルダの両方が届くまで進める（フォルダ名が見えたら準備完了）。 */
    for (let i = 0; i < 30 && !screen.queryByText('新作の案内'); i += 1) await flush()
    for (let i = 0; i < 30 && !screen.queryByText('販促'); i += 1) await flush()
    expect(screen.getByText('新作の案内'), '行が出る').toBeTruthy()
    expect(screen.queryByText('販促'), 'フォルダが届く').toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '配信「新作の案内」の操作' }))
    await flush()
    expect(screen.queryByRole('menu'), 'メニューが開く').toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'フォルダへ移す' }))
    await flush()
    fireEvent.click(screen.getByRole('menuitem', { name: '販促' }))
    await flush()
    /* 押した瞬間に保存の口を叩き、行はそのまま見える（楽観反映）。 */
    expect(apiMock.broadcastsUpdate, '保存の口を叩く').toHaveBeenCalledWith('b1', { folderId: 'f1', expectedVersion: 3 })
    expect(screen.getByText('新作の案内'), '行は消えない').toBeTruthy()
  })
})
