// @vitest-environment happy-dom
/*
 * #634: 一斉配信の読込表示と、失敗表示からの再読み込み。
 *
 * 監査の実測で、この画面だけは主要APIを遅らせても読込表示が出なかった
 * （骨だけのスケルトンで「読み込んでいます」の文言が無かった）。
 * 失敗表示にも再読み込み口が無かった。
 *
 * ここでは実物の BroadcastsPage を mount し、返さない応答・失敗応答・
 * 再試行ボタンを実DOMで固定する。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  broadcastsList: vi.fn(),
  tagsList: vi.fn(),
  scenariosList: vi.fn(),
  foldersList: vi.fn(),
  savedViewsList: vi.fn(),
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
        savedViews: { list: fixture.savedViewsList },
      },
      tags: { list: fixture.tagsList },
      scenarios: { list: fixture.scenariosList },
      folders: { list: fixture.foldersList },
    },
  }
})

/* 詳細・作成はこの試験の対象外。実部品を読み込む副作用を避けて置き換える。 */
vi.mock('@/components/broadcasts/broadcast-detail', () => ({ default: () => null }))
vi.mock('@/components/broadcasts/broadcast-form', () => ({ default: () => null }))

import BroadcastsPage from './page'

/** 呼び出し側が握る Promise。応答を返さない時間を試験で作る。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const broadcast = {
  id: 'broadcast-1',
  title: '8月キャンペーンのお知らせ',
  messageType: 'text',
  messageContent: 'キャンペーンのご案内です。',
  status: 'scheduled',
  targetType: 'all',
  scheduledAt: '2026-08-20T10:00:00.000Z',
  sentAt: null,
  totalCount: 0,
  successCount: 0,
  folderId: null,
  insightSummary: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.broadcastsList.mockResolvedValue({ success: true, data: [] })
  fixture.tagsList.mockResolvedValue({ success: true, data: [] })
  fixture.scenariosList.mockResolvedValue({ success: true, data: [] })
  fixture.foldersList.mockResolvedValue({ success: true, data: [], unfiledCount: 0 })
  fixture.savedViewsList.mockResolvedValue({ success: true, data: [] })
})

afterEach(cleanup)

describe('#634 一斉配信の読込表示と再読み込み', () => {
  it('応答が返らないあいだ「読み込んでいます」を出す', async () => {
    const slow = deferred<{ success: true; data: unknown[] }>()
    fixture.broadcastsList.mockReturnValue(slow.promise)

    render(<BroadcastsPage />)

    // 応答を保留しているあいだ、ほかの一覧と同じ読込文言が出る。
    await waitFor(() => expect(screen.getByText('読み込んでいます')).toBeTruthy())

    slow.resolve({ success: true, data: [] })
    await waitFor(() => expect(screen.getByText('まだ配信がありません')).toBeTruthy())
    expect(screen.queryByText('読み込んでいます')).toBeNull()
  })

  it('失敗表示の「再読み込み」で一覧を取り直す', async () => {
    fixture.broadcastsList
      .mockResolvedValueOnce({ success: false, error: '失敗' })
      .mockResolvedValueOnce({ success: true, data: [broadcast] })

    render(<BroadcastsPage />)

    await waitFor(() => expect(screen.getByText('表示できませんでした')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))

    await waitFor(() => expect(fixture.broadcastsList).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('8月キャンペーンのお知らせ')).toBeTruthy())
  })
})
