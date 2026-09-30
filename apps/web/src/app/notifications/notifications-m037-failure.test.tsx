// @vitest-environment happy-dom
/*
 * M037: 通知一覧の失敗表示。
 *
 * 共有契約: 読み込み失敗は error={caught} で言い分ける。
 * - 一覧の 403 は汎用文＋再試行にしない。権限の案内のみ（再試行なし）。
 * - 一覧の 429 は待ち案内＋再試行を出す。
 * - 失敗を「通知はまだありません」（空）と混ぜない。
 * - 既読付けは楽観更新（★V7 sTJsh §1）。裏の保存が失敗したら未読へ
 *   戻し、知らせに「もう一度」を出す（再試行の余地を言う）。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  list: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push, replace: fixture.replace }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      notifications: {
        center: {
          list: fixture.list,
          markRead: fixture.markRead,
          markAllRead: fixture.markAllRead,
        },
      },
    },
  }
})

import { ApiError } from '@/lib/api'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import NotificationsPage from './page'

const EMPTY_DATA = {
  items: [],
  counts: { all: 0, error: 0, update: 0, unread: 0 },
  unreadCount: 0,
}

const ONE_UNREAD = {
  items: [
    {
      id: 'n1', eventType: 'info', category: 'info', title: '大事なお知らせ',
      body: '本文', metadata: null, isRead: false, createdAt: '2026-09-26T10:00:00.000Z',
    },
  ],
  counts: { all: 1, error: 0, update: 0, unread: 1 },
  unreadCount: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.list.mockResolvedValue({ success: true, data: EMPTY_DATA })
  fixture.markRead.mockResolvedValue({ success: true })
  fixture.markAllRead.mockResolvedValue({ success: true })
  vi.stubGlobal('React', React)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('M037 一覧の403は汎用文＋再試行にしない', () => {
  it('403は権限の案内のみで、再試行も空状態も出さない', async () => {
    fixture.list.mockRejectedValueOnce(new ApiError(403))
    render(<NotificationsPage />)

    await waitFor(() => expect(screen.getByText(/権限がありません/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull()
    // 失敗を「まだありません」と混ぜない。
    expect(screen.queryByText('通知はまだありません')).toBeNull()
  })

  it('429は待ち案内と一緒に再試行を出す', async () => {
    fixture.list.mockRejectedValueOnce(new ApiError(429))
    render(<NotificationsPage />)

    await waitFor(() => expect(screen.getByText(/混み合っています/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /もう一度読み込む/ })).toBeTruthy()
  })
})

describe('M037 既読付けの失敗は元に戻してやり直せる知らせを出す', () => {
  it('既読にできないときは未読へ戻し、知らせに「もう一度」を出す', async () => {
    clearToastsForTest()
    fixture.list.mockResolvedValueOnce({ success: true, data: ONE_UNREAD })
    fixture.markRead.mockRejectedValueOnce(new Error('down'))
    render(<ToastHost />)
    render(<NotificationsPage />)

    const list = await screen.findByRole('list')
    fireEvent.click(within(list).getByRole('button', { name: /大事なお知らせ/ }))
    // 裏の保存が失敗したら知らせが出て、やり直せる口が付く。
    await waitFor(() => expect(screen.getByText('通知を既読にできませんでした。')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'もう一度' })).toBeTruthy()
  })
})
