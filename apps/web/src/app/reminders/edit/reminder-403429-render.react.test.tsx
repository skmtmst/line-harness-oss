// @vitest-environment happy-dom
/*
 * D015 実描画回帰: リマインダ編集の下書き取得が 403・429 で落ちたとき、
 * 利用者が見る文言・再試行の有無・回復を実際の描画で確かめる。
 * 文字列検査ではなく、合成 GET reject に対する画面の振る舞いを見る。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  getDraft: vi.fn(),
  saveDraft: vi.fn(),
  validateDraft: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: null, enabled: () => false }),
}))
vi.mock('@/lib/api', () => {
  class MockApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  }
  return {
    ApiError: MockApiError,
    api: {
      reminders: {
        getDraft: fixture.getDraft,
        saveDraft: fixture.saveDraft,
        validateDraft: fixture.validateDraft,
      },
    },
  }
})
const { ApiError: TestApiError } = await import('@/lib/api') as unknown as {
  ApiError: new (status: number, message: string) => Error & { status: number }
}

import { Issue469ReminderStepEditor } from './issue469-reminder-screens'

const DRAFT_SETTINGS = {
  name: '予約前のお知らせ',
  description: null,
  lineAccountId: 'account-1',
  triggerType: 'booking',
  deliveryMode: 'time',
  triggerFieldId: null,
  triggerEventId: null,
  repeatYearly: false,
  triggerOffsetMinutes: null,
  sendAtTime: '18:00',
  targetTagId: null,
  folderId: null,
  stopConditions: {
    bookingCancelled: true,
    supportMarkCompleted: false,
    daysAfterTarget: 7,
    friendBlocked: true,
  },
  steps: [
    { stableStepId: 's-1', offsetMinutes: 0, offsetDays: -1, sendAtTime: '18:00', messageType: 'text', messageContent: '前日のお知らせ本文' },
  ],
}

function draftResponse() {
  return {
    success: true,
    data: {
      reminderId: 'r-1',
      versionId: 'v-1',
      versionNumber: 1,
      status: 'draft',
      settings: structuredClone(DRAFT_SETTINGS),
      lastTestStatus: null,
      lastTestedAt: null,
      publishedAt: null,
    },
  }
}

beforeEach(() => {
  fixture.getDraft.mockReset()
  fixture.saveDraft.mockReset()
  fixture.validateDraft.mockReset()
  fixture.validateDraft.mockResolvedValue({ success: true, data: null })
})
afterEach(cleanup)

describe('D015 リマインダ編集の取得失敗（実描画）', () => {
  it('403は権限の理由を出し、再試行は出さず、保存もできない', async () => {
    fixture.getDraft.mockRejectedValue(new TestApiError(403, 'API error: 403'))
    render(<Issue469ReminderStepEditor reminderId="r-1" />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('リマインダを見る権限がありません')).not.toBeNull()
    expect(within(alert).getByText(/見るには権限が要ります/)).not.toBeNull()
    // 押しても直らないので再試行の口は出ない。保存の口もない。
    expect(within(alert).queryByRole('button')).toBeNull()
    expect(screen.queryByText('リマインダを読み込めませんでした')).toBeNull()
  })

  it('429は混雑の待ち理由を出し、再試行を残す', async () => {
    fixture.getDraft.mockRejectedValue(new TestApiError(429, 'API error: 429'))
    render(<Issue469ReminderStepEditor reminderId="r-1" />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('混み合っています')).not.toBeNull()
    expect(within(alert).getByText(/少し待ってから、もう一度読み込んでください/)).not.toBeNull()
    expect(within(alert).getByRole('button', { name: 'もう一度読み込む' })).not.toBeNull()
  })

  it('429から読み直すと直り、古い失敗文は消える', async () => {
    fixture.getDraft.mockRejectedValueOnce(new TestApiError(429, 'API error: 429'))
    fixture.getDraft.mockResolvedValue(draftResponse())
    render(<Issue469ReminderStepEditor reminderId="r-1" />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('混み合っています')).not.toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => {
      expect(screen.queryByText('混み合っています')).toBeNull()
    })
    expect(fixture.getDraft).toHaveBeenCalledTimes(2)
    // 下書きが描かれる（通知ステップの1通目の本文が複数箇所に出る）。
    expect(screen.getAllByText('前日のお知らせ本文').length).toBeGreaterThanOrEqual(1)
  })
})
