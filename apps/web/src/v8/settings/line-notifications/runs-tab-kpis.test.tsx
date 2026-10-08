// @vitest-environment happy-dom
/*
 * 監査 WEB201/202：送れなかったものの数のマス。
 * - 201：読み込んだページだけから数えたときは「このページの n件から」と書く。期間を言い切らない
 * - 202：「メールで送った」を送れなかった一覧から数えない
 */
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/line-notifications',
}))
const run = vi.hoisted(() => (id: string, channel: 'line' | 'email', reason: string) => ({
  id, recipientType: 'customer', notificationName: '注文', source: 'ec', sourceEventId: 'e', friendId: 'f', friendName: '田中',
  orderNumber: 'A-1', channel, status: 'failed', reason, receivedAt: '2026-10-01T00:00:00Z', acceptedAt: null, attemptCount: 1,
  nextRetryAt: null, clickedAt: null, version: 1, executionMode: 'automatic',
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  const page = {
    success: true,
    data: { items: [run('r1', 'line', 'ブロックされていました'), run('r2', 'email', 'メールが届きませんでした')], summary: { failed: 57 }, coverage: { source: 'notification_delivery_ledger' } },
    pagination: { total: 57, limit: 20, offset: 0 },
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

test('ページだけから数えたと書き、メールで送ったは数えない', async () => {
  render(<RunsTab lineAccountId="acc" mode="failures" />)
  await waitFor(() => expect(screen.getByText(/このページの2件から・対応不要/)).toBeTruthy())
  expect(screen.queryByText('この7日')).toBeNull()
  expect(screen.getByText('お知らせの記録で見られます')).toBeTruthy()
})
