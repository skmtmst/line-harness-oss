// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fixture = vi.hoisted(() => ({
  broadcastsList: vi.fn(),
  broadcastsUpdate: vi.fn(),
  tagsList: vi.fn(),
  scenariosList: vi.fn(),
  foldersList: vi.fn(),
  savedViewsList: vi.fn(),
  staffMe: vi.fn(),
  dashboardOverview: vi.fn(),
  getInsight: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: { id: 'account-a', name: 'テスト店' },
  }),
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) {
      super(`API error ${status}`)
      this.status = status
    }
  }
  return {
    ApiError,
    api: {
      broadcasts: {
        list: fixture.broadcastsList,
        update: fixture.broadcastsUpdate,
        getInsight: fixture.getInsight,
        savedViews: { list: fixture.savedViewsList },
      },
      tags: { list: fixture.tagsList },
      scenarios: { list: fixture.scenariosList },
      folders: { list: fixture.foldersList },
      staff: { me: fixture.staffMe },
      dashboard: { overview: fixture.dashboardOverview },
    },
  }
})

vi.mock('@/components/broadcasts/broadcast-form', () => ({ default: () => null }))

import BroadcastListV8 from '@/v8/broadcasts/list'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

function broadcast() {
  return {
    id: 'broadcast-1',
    title: '朝の挨拶',
    messageType: 'text',
    messageContent: 'おはようございます。',
    status: 'scheduled',
    targetType: 'all',
    scheduledAt: '2026-10-10T10:00:00.000Z',
    sentAt: null,
    totalCount: 0,
    successCount: 0,
    folderId: 'folder-a',
    version: 1,
    insightSummary: null,
  }
}

const folder = { id: 'folder-a', name: '朝活', color: null, itemCount: 1 }

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  /* 広い板（1440）のふり。happy-dom は狭い板扱いになり、フォルダが左の列でなく選ぶ欄になる。 */
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }),
  })
  fixture.broadcastsList.mockResolvedValue({
    success: true,
    data: [broadcast()],
  })
  fixture.broadcastsUpdate.mockResolvedValue({ success: true, data: {} })
  fixture.tagsList.mockResolvedValue({ success: true, data: [] })
  fixture.scenariosList.mockResolvedValue({ success: true, data: [] })
  fixture.foldersList.mockResolvedValue({ success: true, data: [folder], unfiledCount: 0 })
  fixture.savedViewsList.mockResolvedValue({ success: true, data: [] })
  fixture.staffMe.mockResolvedValue({ success: false, error: 'not needed' })
  fixture.dashboardOverview.mockResolvedValue({ success: false, error: 'not needed' })
  fixture.getInsight.mockResolvedValue({ success: false, error: 'not needed' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  clearToastsForTest()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    }
  }
}

function renderList() {
  act(() => {
    root.render(<><BroadcastListV8 /><ToastHost /></>)
  })
}

function buttonsIn(scope: ParentNode, text: string) {
  return [...scope.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === text,
  )
}

test('フォルダへ移すは保存を待たず行が消え、保存失敗なら元の行へ戻る', async () => {
  let failSave!: (error: Error) => void
  fixture.broadcastsUpdate.mockImplementation(() => new Promise((_resolve, reject) => { failSave = reject }))
  renderList()
  await eventually(() => {
    if (!host.textContent?.includes('朝の挨拶')) throw new Error('no rows yet')
  })
  // フォルダ「朝活」で絞る。
  const folderButton = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.includes('朝活'),
  ) as HTMLElement
  expect(folderButton).toBeTruthy()
  await act(async () => { folderButton.click() })
  await eventually(() => {
    if (!host.textContent?.includes('朝の挨拶')) throw new Error('row lost after filter')
  })
  // 行の「…」→「フォルダへ移す」→「未分類」。
  const menuButton = host.querySelector('[aria-label="配信「朝の挨拶」の操作"]') as HTMLElement
  expect(menuButton).toBeTruthy()
  await act(async () => { menuButton.click() })
  await eventually(() => {
    if (buttonsIn(document, 'フォルダへ移す').length === 0) throw new Error('no move menu yet')
  })
  await act(async () => { buttonsIn(document, 'フォルダへ移す')[0].click() })
  await eventually(() => {
    if (buttonsIn(document, '未分類').length === 0) throw new Error('no folder menu yet')
  })
  await act(async () => { buttonsIn(document, '未分類')[0].click() })
  // 押した瞬間に絞り込みから外れる（裏の保存を待たない）。
  await eventually(() => {
    if (host.textContent?.includes('朝の挨拶')) throw new Error('still shown')
  })
  expect(fixture.broadcastsUpdate).toHaveBeenCalledWith('broadcast-1', expect.objectContaining({ folderId: null }))
  await act(async () => { failSave(new Error('save failed')); await Promise.resolve() })
  await eventually(() => {
    if (!host.textContent?.includes('朝の挨拶')) throw new Error('not yet reverted')
  })
})

test('読み込み中は出来上がりと同じ形の骨組みを出す', async () => {
  fixture.broadcastsList.mockImplementation(
    () => new Promise(() => undefined) as unknown as Promise<never>,
  )
  renderList()
  await eventually(() => {
    const busy = host.querySelector('[aria-busy="true"]')
    if (!busy) throw new Error('no busy container yet')
    if (!busy.querySelector('[data-skeleton]')) throw new Error('no skeleton yet')
  }, 8000)
})
