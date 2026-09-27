// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R16 の差し込みボタンと見本の再発防止。
 *
 * 差し込みは押せるボタンで、押すと本文のカーソル位置に入り、
 * カーソルはその後ろへ移る。本文の下と LINE プレビューには
 * 同じ見本値で読んだ文が出る。
 */

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
    constructor(public status: number, message: string) {
      super(message)
      this.name = 'ApiError'
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
  targetCondition: null,
  folderId: null,
  stopConditions: {
    bookingCancelled: true,
    supportMarkCompleted: false,
    daysAfterTarget: 7,
    friendBlocked: true,
  },
  steps: [
    { stableStepId: 's-1', offsetMinutes: 0, offsetDays: -1, sendAtTime: '18:00', messageType: 'text', messageContent: '{{name}}さん、こんにちは' },
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
  fixture.getDraft.mockResolvedValue(draftResponse())
  fixture.validateDraft.mockResolvedValue({
    success: true,
    data: { valid: true, checks: [], audience: { matched: 5, excluded: 1 } },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('通知ステップの差し込みボタンと見本', () => {
  it('差し込みは押せるボタンで表示だけの札を出さない', async () => {
    const { container } = render(<Issue469ReminderStepEditor reminderId="r-1" />)
    await waitFor(() => expect(container.querySelector('textarea')).toBeTruthy())
    const nameButton = screen.getByRole('button', { name: '名前' })
    expect(nameButton.tagName).toBe('BUTTON')
    // 表示だけの札 (Pill) は差し込み欄に出さない。
    expect(screen.queryByText('回答フォーム')).toBeNull()
  })

  it('名前を押すとカーソル位置に入り、見本に同じ値が出る', async () => {
    const { container } = render(<Issue469ReminderStepEditor reminderId="r-1" />)
    await waitFor(() => expect(container.querySelector('textarea')).toBeTruthy())
    const area = container.querySelector('textarea') as HTMLTextAreaElement
    // カーソルを文末へ置く。
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
    fireEvent.click(screen.getByRole('button', { name: '名前' }))
    await waitFor(() => expect(area.value).toContain('{{name}}さん、こんにちは{{name}}'))
    // 本文の下の見本行は「見本：」付きで出す。
    expect(screen.getByText('見本：山田花子さん、こんにちは山田花子')).toBeTruthy()
    // LINE プレビューは同じ値を「見本：」なしで出す。
    expect(screen.getByText('山田花子さん、こんにちは山田花子')).toBeTruthy()
  })

  it('差し込みの無い本文では見本を出さない', async () => {
    fixture.getDraft.mockResolvedValue({
      ...draftResponse(),
      data: {
        ...draftResponse().data,
        settings: { ...structuredClone(DRAFT_SETTINGS), steps: [{ ...DRAFT_SETTINGS.steps[0], messageContent: 'こんにちは' }] },
      },
    })
    const { container } = render(<Issue469ReminderStepEditor reminderId="r-1" />)
    await waitFor(() => expect(container.querySelector('textarea')).toBeTruthy())
    expect(screen.queryByText(/見本：/)).toBeNull()
  })
})
