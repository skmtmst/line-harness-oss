// @vitest-environment happy-dom
/*
 * V8 通知（src/v8/notifications）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 未読が先・新しい順／行の右の行き先の言葉（EC連携は EC連携へ）／押すと既読にして移る／
 * タブは「すべて 6」の1つの文字／未読が無いと「すべて既読にする」は押せない。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { NotificationCenterItem } from '@line-crm/shared'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

const markRead = vi.fn(() => Promise.resolve({ success: true }))
let items: NotificationCenterItem[] = []
vi.mock('@/lib/api', () => ({
  api: {
    notifications: {
      center: {
        list: vi.fn(() => Promise.resolve({
          success: true,
          data: {
            items,
            counts: {
              all: items.length,
              error: items.filter((x) => x.category === 'error').length,
              update: items.filter((x) => x.category === 'update').length,
              unread: items.filter((x) => !x.isRead).length,
            },
            unreadCount: items.filter((x) => !x.isRead).length,
          },
        })),
        markRead: (...args: unknown[]) => markRead(...(args as [])),
        markAllRead: () => Promise.resolve({ success: true }),
      },
    },
  },
}))

import NotificationsV8 from './list'

const item = (id: string, eventType: string, category: string, title: string, isRead: boolean, createdAt: string): NotificationCenterItem => ({
  id, eventType, category: category as NotificationCenterItem['category'], title, body: '', metadata: null, isRead, createdAt,
})

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  push.mockClear()
  markRead.mockClear()
  // 口は作成日の新しい順で返す（既読が混ざっていても）。
  items = [
    item('n-read', 'visual_qa.update', 'update', '既読の新しい版', true, '2026-08-25T00:00:00.000Z'),
    item('n-hook', 'account_health_webhook_delay', 'error', 'Webhook の遅れ', false, '2026-08-21T09:32:00.000Z'),
    item('n-ec', 'ec.import_failed', 'error', 'EC連携の取り込みが失敗', false, '2026-08-21T00:15:00.000Z'),
    item('n-mt', 'maintenance.scheduled', 'update', 'メンテナンス予定', true, '2026-08-12T00:00:00.000Z'),
  ]
})
afterEach(() => cleanup())

describe('V8 通知', () => {
  test('未読が先・新しい順。右の言葉は行き先どおり', async () => {
    render(<NotificationsV8 />)
    await screen.findByText('Webhook の遅れ')
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Webhook の遅れ'),
      expect.stringContaining('EC連携の取り込みが失敗'),
      expect.stringContaining('既読の新しい版'),
      expect.stringContaining('メンテナンス予定'),
    ])
    expect(within(rows[0]).getByText('運用状態を開く →')).toBeTruthy()
    expect(within(rows[1]).getByText('EC連携を開く →')).toBeTruthy()
    expect(within(rows[2]).getByText('更新履歴を見る →')).toBeTruthy()
    expect(within(rows[3]).getByText('詳細を見る →')).toBeTruthy()
  })

  test('タブは「すべて 4」の1つの文字', async () => {
    render(<NotificationsV8 />)
    expect(await screen.findByRole('tab', { name: 'すべて 4' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'エラー 2' })).toBeTruthy()
  })

  test('EC連携の通知を押すと既読にして EC連携へ移る', async () => {
    render(<NotificationsV8 />)
    const title = await screen.findByText('EC連携の取り込みが失敗')
    fireEvent.click(title.closest('button')!)
    expect(push).toHaveBeenCalledWith('/ec-commerce')
    await waitFor(() => expect(markRead).toHaveBeenCalledWith('n-ec', 'account-a'))
  })

  test('未読が無いと「すべて既読にする」は押せず、注記が替わる', async () => {
    items = items.map((x) => ({ ...x, isRead: true }))
    render(<NotificationsV8 />)
    expect(await screen.findByText('未読のお知らせはありません。')).toBeTruthy()
    expect((screen.getByRole('button', { name: /すべて既読にする/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
