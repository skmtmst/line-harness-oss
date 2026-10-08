// @vitest-environment happy-dom
/*
 * 監査 WEB071：A で「すべて既読にする」が失敗して戻るとき、もう B に移っていたら
 * A の一覧・数で B の一覧を巻き戻さない。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { NotificationCenterItem } from '@line-crm/shared'

const fx = vi.hoisted(() => ({ account: 'account-a', rejectAll: null as null | ((e: unknown) => void) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fx.account, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

const item = (id: string, title: string): NotificationCenterItem => ({
  id, eventType: 'maintenance.scheduled', category: 'update', title, body: '', metadata: null, isRead: false, createdAt: '2026-10-01T00:00:00.000Z',
})
vi.mock('@/lib/api', () => ({
  api: {
    notifications: {
      center: {
        list: vi.fn((accountId: string) => {
          const items = [item(`${accountId}-1`, accountId === 'account-a' ? 'Aのお知らせ' : 'Bのお知らせ')]
          return Promise.resolve({ success: true, data: { items, counts: { all: 1, error: 0, update: 1, unread: 1 }, unreadCount: 1 } })
        }),
        markRead: () => Promise.resolve({ success: true }),
        markAllRead: () => new Promise((_, reject) => { fx.rejectAll = reject }),
      },
    },
  },
}))

import NotificationsV8 from './list'
afterEach(cleanup)

test('A の「すべて既読」の失敗で、B の一覧を A に戻さない', async () => {
  const view = render(<NotificationsV8 />)
  await screen.findByText('Aのお知らせ')
  await act(async () => { screen.getByRole('button', { name: /すべて既読にする/ }).click() })
  fx.account = 'account-b'
  view.rerender(<NotificationsV8 />)
  await screen.findByText('Bのお知らせ')
  await act(async () => { fx.rejectAll?.(new Error('down')) })
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByText('Aのお知らせ')).toBeNull()
  expect(screen.getByText('Bのお知らせ')).toBeTruthy()
})
