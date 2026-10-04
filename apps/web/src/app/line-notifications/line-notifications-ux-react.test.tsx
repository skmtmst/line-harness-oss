// @vitest-environment happy-dom
/*
 * V8 サクサク感（お知らせ）：顧客タブの読み込み中は表の形の骨組みが出て
 * 「読み込み中」の文字は無い。
 */
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  settings: vi.fn(),
  overview: vi.fn(),
  operatorList: vi.fn(),
  definitions: vi.fn(),
  metrics: vi.fn(),
  quota: vi.fn(),
  sendCounts: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/line-notifications',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
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
        sendCounts: fixture.sendCounts,
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
  fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 }, items: [] } })
  fixture.settings.mockResolvedValue({ success: true, data: [] })
  fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
  fixture.metrics.mockResolvedValue({ success: true, data: { items: [] } })
  fixture.sendCounts.mockResolvedValue({ success: true, data: { items: [] } })
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

it('顧客タブの読み込み中は骨組みが出て「読み込み中」の文字は無い', async () => {
  document.documentElement.dataset.theme = 'v8'
  // 顧客の定義だけ返さず、読み込み中のままにする。
  fixture.definitions.mockReturnValue(new Promise(() => {}))
  const { container } = render(<LineNotificationsPage />)
  await waitFor(() => {
    expect(container.querySelector('[aria-label="顧客へのお知らせを読み込んでいます"]')).not.toBeNull()
  })
  await new Promise((resolve) => setTimeout(resolve, 600))
  await waitFor(
    () => {
      expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
    },
    { timeout: 3000 },
  )
  expect(screen.queryByText(/読み込んでいます/)).toBeNull()
  delete document.documentElement.dataset.theme
})
