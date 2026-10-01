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
import React, { act } from 'react'
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

  /*
   * M037 faithful oracle: 未読row/count復元の実DOM検査。
   * 実NotificationsPage/ToastHost/runOptimisticを描画し、API/router transportだけmock。
   * 同じ描画rootを最後まで保ち、deferred応答でpending→復元→再試行→既読を追う。
   * router.push spyはnative遷移の再現ではない (functional証拠・PARTIAL維持)。
   */
  it('未読rowと全既読ボタンが失敗で復元し、再試行の成功で既読へ戻る', async () => {
    clearToastsForTest()
    fixture.list.mockResolvedValueOnce({ success: true, data: ONE_UNREAD })
    const gates: Array<{
      resolve: (value: unknown) => void
      reject: (reason?: unknown) => void
    }> = []
    fixture.markRead.mockImplementation(
      () => new Promise((resolve, reject) => { gates.push({ resolve, reject }) }),
    )
    render(
      <>
        <ToastHost />
        <NotificationsPage />
      </>,
    )

    // 1. 初期: rowに（未読）、全既読ボタン活性、list1回。
    const list = await screen.findByRole('list')
    const rowName = /大事なお知らせ/
    expect(within(list).getByRole('button', { name: rowName }).textContent).toContain('（未読）')
    const markAll = screen.getByRole('button', { name: 'すべて既読にする' })
    expect(markAll.disabled).toBe(false)
    expect(fixture.list).toHaveBeenCalledTimes(1)

    // 2. 実row click→同ID/accountへ単件API1回・push(/updates)。pending中は未読印消失・全既読disabled。
    fireEvent.click(within(list).getByRole('button', { name: rowName }))
    await waitFor(() => expect(fixture.markRead).toHaveBeenCalledTimes(1))
    expect(fixture.markRead).toHaveBeenLastCalledWith('n1', 'account-a')
    expect(fixture.push).toHaveBeenCalledTimes(1)
    expect(fixture.push).toHaveBeenCalledWith('/updates')
    expect(within(list).getByRole('button', { name: rowName }).textContent).not.toContain('（未読）')
    expect(screen.getByRole('button', { name: 'すべて既読にする' }).disabled).toBe(true)

    // 3. 真正503reject→同じrow未読復元・全既読enabled・日本語Toast/もう一度。list1・markAllRead0。
    gates[0].reject(new ApiError(503))
    await waitFor(() => expect(
      within(list).getByRole('button', { name: rowName }).textContent,
    ).toContain('（未読）'))
    expect(screen.getByRole('button', { name: 'すべて既読にする' }).disabled).toBe(false)
    await waitFor(() => expect(screen.getByText('通知を既読にできませんでした。')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'もう一度' })).toBeTruthy()
    expect(fixture.list).toHaveBeenCalledTimes(1)
    expect(fixture.markAllRead).not.toHaveBeenCalled()

    // 4. 実Toast retry→2回目は同ID/account、success:falseで再び復元 (二重増加なし)。
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }))
    await waitFor(() => expect(fixture.markRead).toHaveBeenCalledTimes(2))
    expect(fixture.markRead).toHaveBeenLastCalledWith('n1', 'account-a')
    // 第2retryのpending中も未読印消失・全既読disabledを実DOMで見る。
    expect(within(list).getByRole('button', { name: rowName }).textContent).not.toContain('（未読）')
    expect(screen.getByRole('button', { name: 'すべて既読にする' }).disabled).toBe(true)
    gates[1].resolve({ success: false, error: 'audit_unavailable' })
    await waitFor(() => expect(
      within(list).getByRole('button', { name: rowName }).textContent,
    ).toContain('（未読）'))
    expect(screen.getByRole('button', { name: 'すべて既読にする' }).disabled).toBe(false)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'もう一度' }).length).toBeGreaterThan(0))

    // 5. retry→3回目 success:trueで既読・ボタンdisabledへ。失敗Toast解除・再取得なし。
    fireEvent.click(screen.getAllByRole('button', { name: 'もう一度' })[0])
    await waitFor(() => expect(fixture.markRead).toHaveBeenCalledTimes(3))
    expect(fixture.markRead).toHaveBeenLastCalledWith('n1', 'account-a')
    gates[2].resolve({ success: true })
    // 実Promise microtaskをflushしてから成功完了をassert (pending同値のまま主張しない)。
    await act(async () => { await Promise.resolve() })
    await waitFor(() => expect(
      within(list).getByRole('button', { name: rowName }).textContent,
    ).not.toContain('（未読）'))
    expect(screen.getByRole('button', { name: 'すべて既読にする' }).disabled).toBe(true)
    expect(screen.queryByText('通知を既読にできませんでした。')).toBeNull()
    expect(fixture.list).toHaveBeenCalledTimes(1)
    expect(fixture.markAllRead).not.toHaveBeenCalled()
    expect(fixture.push).toHaveBeenCalledTimes(1)
  })
})
