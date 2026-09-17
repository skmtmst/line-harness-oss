// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderDeliveryRunsResponse } from '@/lib/api'

const apiMock = vi.hoisted(() => ({
  runs: vi.fn(),
  retryRun: vi.fn(),
  update: vi.fn(),
  registrantsList: vi.fn(),
  registrantsUpdateTargetDate: vi.fn(),
  registrantsCancel: vi.fn(),
  registrantsResume: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('id=rem-1'),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/lib/api', () => ({
  api: { reminders: {
    runs: apiMock.runs,
    retryRun: apiMock.retryRun,
    update: apiMock.update,
    registrants: {
      list: apiMock.registrantsList,
      updateTargetDate: apiMock.registrantsUpdateTargetDate,
      cancel: apiMock.registrantsCancel,
      resume: apiMock.registrantsResume,
    },
  } },
}))

import ReminderRunsPage from './page'

const RESPONSE = (overrides: Partial<ReminderDeliveryRunsResponse['reminder']> = {}): ReminderDeliveryRunsResponse => ({
  reminder: {
    id: 'rem-1',
    name: '予約前のお知らせ',
    isActive: true,
    lifecycleStatus: 'published',
    stopConditions: {
      bookingCancelled: false,
      supportMarkCompleted: false,
      daysAfterTarget: 7,
      friendBlocked: true,
    },
    ...overrides,
  },
  summary: { sent: 0, scheduled: 0, stopped: 0, errors: 0, targetCount: 0, nextScheduledAt: null },
  steps: [],
  items: [],
  pagination: { total: 0, limit: 20, offset: 0 },
})

beforeEach(() => {
  apiMock.registrantsList.mockResolvedValue({ success: true, data: [] })
  apiMock.update.mockResolvedValue({ success: true, data: {} })
})

afterEach(cleanup)

describe('リマインダ詳細の停止予定', () => {
  it('公開版の停止条件を実値で出す', async () => {
    apiMock.runs.mockResolvedValue({ success: true, data: RESPONSE() })
    render(<ReminderRunsPage />)
    await waitFor(() => expect(screen.getByText('基準日から7日後に自動終了・ブロックで即時停止')).toBeTruthy())
    // 「停止予定」行が固定の「—」でないことを、実値の表示で確認する。
    expect(screen.getByText('停止予定')).toBeTruthy()
  })

  it('停止条件がすべて無効なら「自動停止なし」、公開版が無ければ「未設定」と区別する', async () => {
    apiMock.runs.mockResolvedValue({
      success: true,
      data: RESPONSE({ stopConditions: { bookingCancelled: false, supportMarkCompleted: false, daysAfterTarget: null, friendBlocked: false } }),
    })
    const { unmount } = render(<ReminderRunsPage />)
    await waitFor(() => expect(screen.getByText('自動停止なし')).toBeTruthy())
    unmount()

    apiMock.runs.mockResolvedValue({ success: true, data: RESPONSE({ stopConditions: null }) })
    render(<ReminderRunsPage />)
    await waitFor(() => expect(screen.getByText('未設定')).toBeTruthy())
  })

  it('停止済みのリマインダは「停止済み」を出し、再開ボタンが実際にAPIを呼ぶ', async () => {
    apiMock.runs.mockResolvedValue({
      success: true,
      data: RESPONSE({ isActive: false, lifecycleStatus: 'stopped' }),
    })
    render(<ReminderRunsPage />)
    await waitFor(() => expect(screen.getByText('停止済み')).toBeTruthy())
    const resume = screen.getByText('リマインダを再開')
    fireEvent.click(resume)
    await waitFor(() => expect(apiMock.update).toHaveBeenCalledWith('rem-1', { isActive: true }))
  })

  it('稼働中は一時停止ボタンが実際にAPIを呼ぶ', async () => {
    apiMock.runs.mockResolvedValue({ success: true, data: RESPONSE() })
    render(<ReminderRunsPage />)
    const pause = await screen.findByText('リマインダを一時停止')
    fireEvent.click(pause)
    await waitFor(() => expect(apiMock.update).toHaveBeenCalledWith('rem-1', { isActive: false }))
  })
})
