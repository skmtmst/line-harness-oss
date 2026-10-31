// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import NotificationsPane from '@/test-utils/webinar-notifications'
import type { WebinarEditor } from '@/lib/api'
const net = vi.hoisted(() => ({ test: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [] }) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, webinarApi: { ...actual.webinarApi,
    notifications: async () => ({ data: { settings: { version: 1, registrationEnabled: true, dayBeforeEnabled: true, dayBeforeTime: '19:00', hourBeforeEnabled: true,
      hourBeforeMinutes: 15, startEnabled: true, missedEnabled: false, missedTime: '10:00', missedWindowDays: 3, completedEnabled: true },
      overview: { total: 4, sent: 2, failed: 0, skipped: 0 } } }),
    actions: async () => ({ data: [] }), editor: async () => ({ data: { version: 2, notificationTest: null } }), testNotifications: net.test,
  } }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
it.each(['成功', '失敗'])('前の%sの文を新しく開いた確認窓の赤い理由へ持ち越さない', async previous => {
  if (previous === '成功') net.test.mockResolvedValue({ data: { sent: 2, failed: 0 } })
  else net.test.mockRejectedValue(new Error('テスト送信できませんでした。'))
  render(<NotificationsPane webinarId="webinar" editor={{ version: 2, notificationTest: null } as WebinarEditor} />)
  fireEvent.click(await screen.findByRole('button', { name: 'テストを送る', exact: true }))
  const first = await screen.findByRole('dialog', { name: '通知をテスト送信しますか？' })
  await act(async () => { fireEvent.click(within(first).getByRole('button', { name: 'テストを送る', exact: true })) })
  expect(net.test).toHaveBeenCalledTimes(1)
  if (previous === '失敗') {
    expect(within(first).getByRole('alert')).toBeTruthy()
    fireEvent.click(within(first).getByRole('button', { name: 'キャンセル' }))
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'テストを送る', exact: true }))
  const fresh = await screen.findByRole('dialog', { name: '通知をテスト送信しますか？' })
  expect(within(fresh).queryByText(/テスト送信しました|テスト送信できませんでした/)).toBeNull()
  expect(within(fresh).queryByRole('alert')).toBeNull()
  expect(net.test).toHaveBeenCalledTimes(1)
})
