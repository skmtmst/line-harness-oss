// @vitest-environment happy-dom
/*
 * R195: テンプレートの作成・移動・削除のあと、フォルダの件数
 * （「すべて」「未分類」・各フォルダの数）を読み直す。
 *
 * 以前は一覧だけ読み直し、フォルダ側の件数が再読込するまで古いまま
 * だった。「削除したのに未分類の数が減らない」見え方を消す。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  foldersList: vi.fn(),
  templatesDelete: vi.fn(),
  templatesUpdate: vi.fn(),
  templatesList: vi.fn(),
}))

const TEMPLATE = {
  id: 'tpl-1', name: '来店お礼', category: 'general', messageType: 'text',
  messageContent: 'ご来店ありがとうございました。', folderId: null, question: null,
  questionStatus: 'published', usageCount: 0, tapCount: 0,
  monthlySendCount: 0, totalSendCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

const FOLDER = {
  id: 'folder-sales', kind: 'template', name: '営業', parentId: null,
  displayOrder: 0, color: null, itemCount: 1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

const EMPTY_USED_BY = {
  autoReplies: [], automations: [], scenarioSteps: [],
  reminderSteps: [], richMenuAreas: [], trackedLinks: [], broadcasts: [],
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: fixture.templatesList,
      get: (id: string) => Promise.resolve({
        success: true,
        data: {
          ...TEMPLATE, id,
          usedBy: EMPTY_USED_BY,
          hasDraft: false, publishedVersion: 1, publishedAt: '2026-09-01T00:00:00.000Z',
          draftRevision: 0, carouselActions: null, carouselTapLimitMode: 'none',
          carouselTapLimitText: null,
        },
      }),
      create: vi.fn(() => Promise.resolve({ success: true, data: { id: 'new-tpl' } })),
      update: fixture.templatesUpdate,
      delete: fixture.templatesDelete,
      publish: vi.fn(),
    },
    broadcastMessageAssets: {
      list: () => Promise.resolve({ success: true, data: [] }),
      counts: () => Promise.resolve({ success: true, data: { card_message: 0, rich_message: 0, coupon: 0, research: 0 } }),
    },
    folders: {
      list: fixture.foldersList,
      update: vi.fn(() => Promise.resolve({ success: true, data: {} })),
      delete: vi.fn(() => Promise.resolve({ success: true, data: null })),
      create: vi.fn(() => Promise.resolve({ success: true, data: {} })),
    },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/templates',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

import TemplatesPage from './page'

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? 'owner' : null),
    setItem: () => {},
    removeItem: () => {},
  })
  fixture.foldersList.mockReset()
  fixture.foldersList.mockResolvedValue({ success: true, data: [FOLDER], unfiledCount: 1 })
  fixture.templatesList.mockReset()
  fixture.templatesList.mockResolvedValue({ success: true, data: [TEMPLATE] })
  fixture.templatesDelete.mockReset()
  fixture.templatesDelete.mockResolvedValue({ success: true, data: null })
  fixture.templatesUpdate.mockReset()
  fixture.templatesUpdate.mockResolvedValue({ success: true, data: TEMPLATE })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderReady() {
  const view = render(<TemplatesPage />)
  await screen.findByRole('table')
  return view
}

describe('R195 フォルダ件数の読み直し', () => {
  test('削除したあと、一覧と一緒にフォルダ件数も読み直す', async () => {
    await renderReady()
    const beforeCalls = fixture.foldersList.mock.calls.length

    // 行の「…」→「テンプレートを削除」→確認窓で「削除する」
    // （表とモバイルカードの両方にメニューがあるので先頭を押す）
    fireEvent.click(screen.getAllByRole('button', { name: '来店お礼のその他操作' })[0])
    fireEvent.click((await screen.findAllByRole('menuitem', { name: 'テンプレートを削除' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: '削除する' }))

    await vi.waitFor(() => {
      expect(fixture.templatesDelete).toHaveBeenCalled()
      expect(fixture.foldersList.mock.calls.length).toBeGreaterThan(beforeCalls)
    })
  })

  test('詳細の「置き場」で移すとフォルダ件数も読み直す', async () => {
    await renderReady()
    // 行を開いて詳細を出す
    const table = screen.getByRole('table')
    fireEvent.click(within(table).getByText('来店お礼'))
    const beforeCalls = fixture.foldersList.mock.calls.length

    const selectButton = await screen.findByRole('button', { name: '置き場' })
    await act(async () => { fireEvent.click(selectButton) })
    const option = await screen.findByRole('option', { name: /営業/ })
    // 実際の押し口は選択肢の内側の button。li 自体を押しても動かない。
    await act(async () => { fireEvent.click(within(option).getByRole('button')) })

    await vi.waitFor(() => {
      expect(fixture.templatesUpdate).toHaveBeenCalledWith('tpl-1', { folderId: 'folder-sales' })
      expect(fixture.foldersList.mock.calls.length).toBeGreaterThan(beforeCalls)
    })
  })
})
