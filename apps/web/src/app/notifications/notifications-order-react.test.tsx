// @vitest-environment happy-dom

import React from 'react'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NotificationCenterItem } from '@line-crm/shared'

/*
 * R16: 未読・未対応を扱う一覧は「未読が先・新しい順」。
 * 口は作成日降順のみで返すため、読んだ分は画面側で並べ替える。
 */

const items: NotificationCenterItem[] = [
  {
    id: 'n1', eventType: 'info', category: 'info', title: '既読の古い通知',
    body: 'b1', metadata: null, isRead: true, createdAt: '2026-09-26T10:00:00.000Z',
  },
  {
    id: 'n2', eventType: 'info', category: 'info', title: '未読の古い通知',
    body: 'b2', metadata: null, isRead: false, createdAt: '2026-09-25T10:00:00.000Z',
  },
  {
    id: 'n3', eventType: 'info', category: 'info', title: '未読の新しい通知',
    body: 'b3', metadata: null, isRead: false, createdAt: '2026-09-26T09:00:00.000Z',
  },
  {
    id: 'n4', eventType: 'info', category: 'info', title: '既読の新しい通知',
    body: 'b4', metadata: null, isRead: true, createdAt: '2026-09-26T11:00:00.000Z',
  },
]

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))

vi.mock('@/lib/api', () => ({
  api: {
    notifications: {
      center: {
        list: vi.fn(() => Promise.resolve({
          success: true,
          data: {
            items,
            counts: { all: 4, error: 0, update: 0, unread: 2 },
            unreadCount: 2,
          },
        })),
        markRead: () => Promise.resolve({ success: true }),
        markAllRead: () => Promise.resolve({ success: true }),
      },
    },
  },
}))

import NotificationsPage from './page'

afterEach(cleanup)

describe('通知一覧の並び順（R16）', () => {
  test('未読が先・新しい順に並ぶ', async () => {
    const rendered = render(<NotificationsPage />)
    const list = await rendered.findByRole('list')
    const titles = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
    expect(titles.map((text) => /未読の新しい通知|未読の古い通知|既読の新しい通知|既読の古い通知/.exec(text)?.[0])).toEqual([
      '未読の新しい通知',
      '未読の古い通知',
      '既読の新しい通知',
      '既読の古い通知',
    ])
  })

  test('空のときは作成導線なしの案内だけ出す', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.notifications.center.list).mockResolvedValueOnce({
      success: true,
      data: { items: [], counts: { all: 0, error: 0, update: 0, unread: 0 }, unreadCount: 0 },
    })
    const rendered = render(<NotificationsPage />)
    expect(await rendered.findByText('通知はまだありません。')).toBeTruthy()
  })
})
