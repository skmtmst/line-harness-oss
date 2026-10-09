// @vitest-environment happy-dom
/*
 * N-147: テンプレートのフォルダは選択中アカウント単位。
 *
 * 一覧取得は必ず選択中のアカウントを付けて呼び、アカウントを切り替えたら
 * 前のアカウントのフォルダ・選択中の絞り込みを残さないことを実マウントで
 * 固定する。api は差し替え、通信層の往復だけを記録する。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string }))
const foldersList = vi.hoisted(() => vi.fn())

const TEMPLATES = [
  {
    id: 'tpl-1', name: '来店お礼', category: 'general', messageType: 'text',
    messageContent: 'ご来店ありがとうございました。', folderId: null, question: null,
    usageCount: 3, updatedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
  },
]

const FOLDERS_BY_ACCOUNT: Record<string, Array<{ id: string; name: string; itemCount: number; color: null; displayOrder: number }>> = {
  'account-a': [{ id: 'folder-a', name: 'A店の予約', itemCount: 1, color: null, displayOrder: 1 }],
  'account-b': [{ id: 'folder-b', name: 'B店の案内', itemCount: 2, color: null, displayOrder: 1 }],
}

const EMPTY_USED_BY = {
  autoReplies: [], automations: [], scenarioSteps: [],
  reminderSteps: [], richMenuAreas: [], trackedLinks: [],
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, accounts: [], loading: false }),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: () => Promise.resolve({ success: true, data: TEMPLATES }),
      get: (id: string) => Promise.resolve({
        success: true,
        data: {
          ...(TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]),
          usedBy: EMPTY_USED_BY,
          hasDraft: true, publishedVersion: 1, publishedAt: '2026-09-01T00:00:00.000Z',
          draftVersion: 2, carouselActions: null, carouselTapLimitMode: 'none',
          carouselTapLimitText: null, questionStatus: 'draft',
        },
      }),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(), publish: vi.fn(),
    },
    broadcastMessageAssets: { list: () => Promise.resolve({ success: true, data: [] }), counts: () => Promise.resolve({ success: true, data: { card_message: 0, rich_message: 0, coupon: 0, research: 0 } }) },
    folders: {
      list: foldersList,
      update: vi.fn(() => Promise.resolve({ success: true, data: {} })),
      delete: vi.fn(() => Promise.resolve({ success: true, data: null })),
      create: vi.fn(() => Promise.resolve({ success: true, data: {} })),
    },
    friendFields: { list: () => Promise.resolve({ success: true, data: [] }) },
    commonVars: { list: () => Promise.resolve({ success: true, data: [] }) },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    supportMarks: { list: () => Promise.resolve({ success: true, data: [] }) },
    scenarios: { list: () => Promise.resolve({ success: true, data: [] }) },
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
  fixture.accountId = 'account-a'
  foldersList.mockReset()
  foldersList.mockImplementation((kind: string, accountId?: string) =>
    Promise.resolve({ success: true, data: FOLDERS_BY_ACCOUNT[accountId ?? ''] ?? [] }),
  )
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? 'owner' : null),
    setItem: () => {},
    removeItem: () => {},
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('テンプレートのフォルダはアカウント単位 (N-147)', () => {
  test('一覧取得は選択中アカウントを付けて呼ぶ', async () => {
    render(<TemplatesPage />)
    await flush()
    await screen.findByText('A店の予約')
    expect(foldersList).toHaveBeenCalledWith('template', 'account-a')
  })

  test('アカウントを切り替えると前のフォルダを残さず、新しいアカウントで読み直す', async () => {
    const view = render(<TemplatesPage />)
    await flush()
    await screen.findByText('A店の予約')

    fixture.accountId = 'account-b'
    await act(async () => { view.rerender(<TemplatesPage />) })
    await flush()

    // Bのフォルダが出て、Aのフォルダ名は残っていない
    await screen.findByText('B店の案内')
    expect(screen.queryByText('A店の予約')).toBeNull()
    expect(foldersList).toHaveBeenCalledWith('template', 'account-b')
    expect(foldersList.mock.calls.filter(([, account]) => account === 'account-a')).toHaveLength(1)
  })

  test('切替直後、新しい一覧が届くまで前のアカウントのフォルダを見せない', async () => {
    const view = render(<TemplatesPage />)
    await flush()
    await screen.findByText('A店の予約')

    // Bの返事を保留にして、切替〜読込完了の間を見る。
    let resolveB: (value: unknown) => void = () => {}
    foldersList.mockImplementation((kind: string, accountId?: string) =>
      accountId === 'account-b'
        ? new Promise((resolve) => { resolveB = resolve })
        : Promise.resolve({ success: true, data: FOLDERS_BY_ACCOUNT[accountId ?? ''] ?? [] }),
    )

    fixture.accountId = 'account-b'
    await act(async () => { view.rerender(<TemplatesPage />) })

    // 読み直しが終わるまで、前のアカウントの帯を残さない。
    expect(screen.queryByText('A店の予約')).toBeNull()

    await act(async () => { resolveB({ success: true, data: FOLDERS_BY_ACCOUNT['account-b'] }) })
    await screen.findByText('B店の案内')
  })
})
