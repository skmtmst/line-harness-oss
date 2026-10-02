// @vitest-environment happy-dom
/*
 * M031: 運用者タブの件数取得で 403 を「取得失敗」と出さない。
 *
 * 共有契約: ListState kind=error は error={caught} を受け、403 は再試行なし・
 * 429 は待ち案内＋再試行。タブの件数も同じ言い分けにする。
 * - 403 → タブは「権限なし」、権限の案内のみ（再試行なし）
 * - 429 → 待ち案内＋「もう一度」で取り直せる
 * - それ以外 → 従来どおり「取得失敗」＋「もう一度」
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
  sendCounts: vi.fn(),
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
  default: ({ tabs }: { tabs: Array<{ key: string; label: string }> }) => (
    <nav aria-label="LINE通知のタブ">{tabs.map((tab) => <span key={tab.key}>{tab.label}</span>)}</nav>
  ),
  useMergedTab: () => 'customer',
}))

vi.mock('@/components/line-notifications/notification-run-list', () => ({ default: () => null }))
vi.mock('./operator-notification-rules', () => ({ default: () => null }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
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
        sendCounts: fixture.sendCounts,
        updateDraft: vi.fn(),
        publishDefinition: vi.fn(),
        stopDefinition: vi.fn(),
        createDefinition: vi.fn(),
      },
    },
  }
})

import { ApiError } from '@/lib/api'
import LineNotificationsPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 7 }, items: [] } })
  fixture.settings.mockResolvedValue({ success: true, data: [] })
  fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
  fixture.definitions.mockResolvedValue({ success: true, data: [] })
  fixture.metrics.mockResolvedValue({ success: true, data: { items: [] } })
  fixture.sendCounts.mockResolvedValue({ success: true, data: { sentToday: 0, sentLast30d: 0, byEventType: [] } })
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

describe('M031 運用者タブの403は取得失敗にしない', () => {
  it('403はタブに「権限なし」と出し、再試行の口は出さない', async () => {
    fixture.operatorList.mockRejectedValueOnce(new ApiError(403))
    render(<LineNotificationsPage />)

    await waitFor(() => expect(screen.getByText('運用者へのお知らせ 権限なし')).toBeTruthy())
    // 取得失敗の言い方は出さない。
    expect(screen.queryByText('運用者へのお知らせ 取得失敗')).toBeNull()
    // 権限の案内は出す。押しても直らない再試行は出さない。
    await waitFor(() => expect(screen.getByText(/見る権限がありません/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'もう一度' })).toBeNull()
  })

  it('429は待ち案内と一緒に「もう一度」を出す', async () => {
    fixture.operatorList.mockRejectedValueOnce(new ApiError(429))
    render(<LineNotificationsPage />)

    await waitFor(() => expect(screen.getByText(/混み合っています/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'もう一度' })).toBeTruthy()
  })

  it('429から「もう一度」で取り直せる', async () => {
    fixture.operatorList
      .mockRejectedValueOnce(new ApiError(429))
      .mockResolvedValueOnce({ success: true, data: { summary: { total: 7 }, items: [] } })
    render(<LineNotificationsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'もう一度' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }))
    await waitFor(() => expect(fixture.operatorList).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('運用者へのお知らせ 7')).toBeTruthy())
  })
})
