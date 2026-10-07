// @vitest-environment happy-dom
/*
 * V8 サクサク感（お知らせ）：顧客タブの読み込み中は表の形の骨組みが出て
 * 「読み込み中」の文字は無い。
 */
import React, { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

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
      // ★V8 の画面は役割（/api/staff/me）で変える操作を出し分ける。
      staff: { me: vi.fn(async () => ({ success: true, data: { role: 'owner' } })) },
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
  // ★V8 の画面は白い板の中に「設定の中のメニュー」を置き、手元の役割（localStorage）を読む。
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
})

/** 偽の時計を 50ms ずつ進めながら、満たすまで（最大2秒ぶん）確かめる。本物の時間は待たない。 */
async function until(check: () => void) {
  for (let i = 0; i < 40; i += 1) {
    try { check(); return } catch { /* もう少し進める */ }
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  }
  check()
}

it('顧客タブの読み込み中は骨組みが出て「読み込み中」の文字は無い', async () => {
  document.documentElement.dataset.theme = 'v8'
  // 顧客の定義だけ返さず、読み込み中のままにする。
  fixture.definitions.mockReturnValue(new Promise(() => {}))
  // 待ちは偽の時計で進める（本物の時間を待たない）。骨組みの 0.3 秒は読み始めから数えるので、描く前に替える。
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  const { container } = render(<LineNotificationsPage />)
  await until(() => {
    expect(container.querySelector('[aria-label="顧客へのお知らせを読み込んでいます"]')).not.toBeNull()
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(600) })
  await until(() => {
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
  })
  expect(screen.queryByText(/読み込んでいます/)).toBeNull()
  delete document.documentElement.dataset.theme
})
