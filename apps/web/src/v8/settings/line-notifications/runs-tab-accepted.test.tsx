// @vitest-environment happy-dom
/*
 * お知らせの記録：LINE が受け付けた行は「LINEが受け付けました」と書く。
 * 受け付けただけで、届いた・開いたとは言わない。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/line-notifications',
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  const page = {
    success: true,
    data: {
      items: [{
        id: 'r1', recipientType: 'customer', notificationName: '注文', source: 'ec', sourceEventId: 'e', friendId: 'f', friendName: '田中',
        orderNumber: 'A-1', channel: 'line', status: 'accepted', reason: null, receivedAt: '2026-10-01T00:00:00Z', acceptedAt: '2026-10-01T00:00:05Z', attemptCount: 1,
        retryAvailable: false, nextRetryAt: null, clickedAt: null, version: 1, executionMode: 'automatic',
      }],
      summary: { accepted: 1 },
      coverage: { source: 'notification_delivery_ledger' },
    },
    pagination: { total: 1, limit: 20, offset: 0 },
  }
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { role: 'owner' } }) },
      lineNotifications: { ...actual.api.lineNotifications, deliveries: async () => page, notificationRuns: async () => page },
      ecCommerce: { ...actual.api.ecCommerce, notificationRuns: async () => page },
    },
  }
})

import RunsTab from './runs-tab'
afterEach(cleanup)

test('LINE が受け付けた行は「LINEが受け付けました」と書き、届いた・開いたとは言わない', async () => {
  const view = render(<RunsTab lineAccountId="acc" mode="history" />)
  expect((await screen.findAllByText('LINEが受け付けました')).length).toBeGreaterThan(0)
  expect(view.container.textContent).not.toContain('届きました')
  expect(view.container.textContent).not.toContain('開きました')
  expect(screen.getByText('1件中 1〜1件')).toBeTruthy()
  expect(screen.getByText('表示中の20件を絞り込み')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '次のページ' })).toBeNull()
})
