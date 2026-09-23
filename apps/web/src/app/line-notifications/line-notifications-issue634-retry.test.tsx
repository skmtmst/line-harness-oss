// @vitest-environment happy-dom
/*
 * #634: LINE通知の運用者タブ件数が取れなかったとき、その場で読み直せる。
 *
 * 監査の実測で、運用者のお知らせ一覧口が失敗するとタブには
 * 「運用者へのお知らせ 取得失敗」と出るが、ページ全体を開き直す
 * 以外に読み直す手段が無かった。
 *
 * ここでは実物の LineNotificationsPage を mount し、
 * 失敗→「もう一度読み込む」→件数が取り直せて帯が消える、を実DOMで固定する。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  operatorList: vi.fn(),
  settings: vi.fn(),
  overview: vi.fn(),
  definitions: vi.fn(),
  metrics: vi.fn(),
  quota: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: { id: 'account-a', name: 'テスト店' },
  }),
}))

vi.mock('@/components/layout/merged-tabs', () => ({
  default: ({ tabs }: { tabs: Array<{ key: string; label: string }> }) =>
    <nav aria-label="LINE通知のタブ">{tabs.map((tab) => <span key={tab.key}>{tab.label}</span>)}</nav>,
  useMergedTab: () => 'customer',
}))

vi.mock('@/components/line-notifications/notification-run-list', () => ({ default: () => null }))
vi.mock('./operator-notification-rules', () => ({ default: () => null }))

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
    fetchApi: fixture.quota,
    api: {
      ecCommerce: {
        settings: fixture.settings,
        overview: fixture.overview,
        testSend: vi.fn(),
      },
      accountSettings: { getTestRecipients: vi.fn() },
      lineNotifications: {
        operatorRules: { list: fixture.operatorList },
        definitions: fixture.definitions,
        metrics: fixture.metrics,
        updateDraft: vi.fn(),
        publishDefinition: vi.fn(),
        stopDefinition: vi.fn(),
        createDefinition: vi.fn(),
      },
    },
  }
})

import LineNotificationsPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 7 }, items: [] } })
  fixture.settings.mockResolvedValue({ success: true, data: [] })
  fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
  fixture.definitions.mockResolvedValue({ success: true, data: [] })
  fixture.metrics.mockResolvedValue({ success: true, data: { items: [] } })
  fixture.quota.mockResolvedValue({
    success: true,
    data: { quota: { state: 'available', total: 500, used: 10, remaining: 490, asOf: '2026-09-15T00:00:00Z' } },
  })
  vi.stubGlobal('React', React)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('#634 運用者タブ件数の取得失敗から読み直せる', () => {
  it('「取得失敗」の帯から「もう一度読み込む」で件数を取り直す', async () => {
    fixture.operatorList
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ success: true, data: { summary: { total: 7 }, items: [] } })

    render(<LineNotificationsPage />)

    // タブには「取得失敗」、その隣に直す道（帯＋ボタン）が出る。
    await waitFor(() => expect(screen.getByText('運用者へのお知らせ 取得失敗')).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/運用者へのお知らせの件数を読み込めませんでした/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))

    // 件数の取得がもう一度走り、届けば実数に戻り帯は消える。
    await waitFor(() => expect(fixture.operatorList).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('運用者へのお知らせ 7')).toBeTruthy())
    expect(screen.queryByText(/運用者へのお知らせの件数を読み込めませんでした/)).toBeNull()
  })
})
