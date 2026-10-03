// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listReplies = vi.hoisted(() => vi.fn())
const updateReply = vi.hoisted(() => vi.fn())
const stopReply = vi.hoisted(() => vi.fn())
const listTemplates = vi.hoisted(() => vi.fn())
const summary = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      autoReplies: { ...actual.api.autoReplies, list: listReplies, update: updateReply, stop: stopReply, summary },
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
  usePathname: () => '/auto-replies',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

import AutoRepliesPage from './page'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

function rule(id: string, name: string, isActive: boolean, lifecycleStatus: string) {
  return {
    id, name, keyword: '予約', matchType: 'contains', keywords: null, respondToAll: false,
    isActive, lifecycleStatus, hits: { period: 1, total: 2 },
    responseContent: 'ご予約を承ります', keywordMatchMode: 'any',
    activeFrom: null, activeUntil: null, responseWeekdays: null, responseHolidayRule: null,
    cooldownMinutes: null, skipWhenOperatorActive: false, oncePerFriend: false,
    messageKinds: null, friendConditions: null, folderId: null, priority: id === 'ar-1' ? 1 : 2,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  listReplies.mockImplementation(async () => ({
    success: true,
    data: [rule('ar-1', '止まっている方', false, 'stopped'), rule('ar-2', '動いている方', true, 'published')],
  }))
  listTemplates.mockImplementation(async () => ({ success: true, data: [] }))
  summary.mockImplementation(async () => ({ success: true, data: { conflictCount: 0 } }))
  listFolders.mockImplementation(async () => ({ success: true, data: [], unfiledCount: 0 }))
  updateReply.mockImplementation(async () => ({ success: true, data: {} }))
  stopReply.mockImplementation(async () => ({ success: true, data: {} }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  clearToastsForTest()
  delete document.documentElement.dataset.theme
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

function renderPage() {
  act(() => {
    root.render(<><AutoRepliesPage /><ToastHost /></>)
  })
}

test('まとめて再開は窓を閉じた瞬間に有効の札になり、元に戻すで送らずに戻る', async () => {
  renderPage()
  await eventually(() => {
    if (!host.textContent?.includes('止まっている方')) throw new Error('no rows yet')
  })
  const checkbox = host.querySelector('[aria-label="止まっている方を選択"]') as HTMLElement
  expect(checkbox).toBeTruthy()
  await act(async () => { checkbox.click() })
  const bulkResume = [...host.querySelectorAll('button')].find((b) => b.textContent === 'まとめて再開') as HTMLElement
  expect(bulkResume).toBeTruthy()
  await act(async () => { bulkResume.click() })
  // 確認窓が出る（窓は document.body 直下の portal に出る）。
  await eventually(() => {
    if (!document.body.textContent?.includes('再開しますか？')) throw new Error('no dialog yet')
  })
  const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === '再開する') as HTMLElement
  expect(confirm).toBeTruthy()
  await act(async () => { confirm.click() })
  // 窓を閉じた瞬間に有効の札へ（裏の保存を待たない）。
  await eventually(() => {
    const pills = [...host.querySelectorAll('span')].filter((s) => s.textContent === '有効')
    if (pills.length < 2) throw new Error('not yet optimistic')
  })
  // 知らせの「元に戻す」で送らずに戻せる。
  const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === '元に戻す') as HTMLElement
  expect(undo).toBeTruthy()
  await act(async () => { undo.click() })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(updateReply).not.toHaveBeenCalled()
  expect(stopReply).not.toHaveBeenCalled()
  await eventually(() => {
    const stopped = [...host.querySelectorAll('span')].filter((s) => s.textContent === '停止中')
    if (stopped.length < 1) throw new Error('not yet reverted')
  })
})

test('読み込み中は出来上がりと同じ形の骨組みを出す', async () => {
  listReplies.mockImplementation(() => new Promise(() => undefined) as unknown as Promise<never>)
  renderPage()
  await eventually(() => {
    const busy = host.querySelector('[aria-busy="true"]')
    if (!busy) throw new Error('no busy container yet')
    if (!busy.querySelector('[data-skeleton]')) throw new Error('no skeleton yet')
  }, 8000)
})
