// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  getDraft: vi.fn(),
  validateDraft: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: null, enabled: () => false }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    reminders: {
      getDraft: fixture.getDraft,
      validateDraft: fixture.validateDraft,
      // 対象の段では数え直し条件が空のため audience は叩かない。
      audience: vi.fn(async () => ({ success: true, data: { matched: 0, excluded: 0, sample: [] } })),
    },
  },
}))

import ReminderPublishFlow from './reminder-publish-flow'

const SETTINGS = {
  name: '予約前のお知らせ',
  description: null,
  lineAccountId: 'account-1',
  triggerType: 'booking',
  deliveryMode: 'time',
  triggerFieldId: null,
  triggerEventId: null,
  repeatYearly: false,
  leapYearPolicy: 'feb28',
  triggerOffsetMinutes: null,
  sendAtTime: null,
  targetTagId: null,
  folderId: null,
  targetCondition: null,
  stopConditions: {
    bookingCancelled: true,
    supportMarkCompleted: false,
    daysAfterTarget: 7,
    friendBlocked: true,
  },
  steps: [],
}

function draftResponse() {
  return {
    success: true,
    data: {
      reminderId: 'rem-1',
      versionId: 'ver-1',
      versionNumber: 1,
      status: 'draft',
      settings: structuredClone(SETTINGS),
      lastTestStatus: null,
      lastTestedAt: null,
      publishedAt: null,
      updatedAt: '2026-09-27T10:00:00.000+09:00',
    },
  }
}

beforeEach(() => {
  fixture.getDraft.mockResolvedValue(draftResponse())
  fixture.validateDraft.mockResolvedValue({
    success: true,
    data: { valid: false, checks: [], audience: { matched: 0, excluded: 0 } },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R145: 対象と停止条件の書きかけがある間の離脱確認', () => {
  it('停止条件を外して一覧へ移ると確認が出て、編集継続で外したまま残る', async () => {
    render(<>
      <a href="/reminders">外の一覧へ</a>
      <ReminderPublishFlow reminderId="rem-1" stage="target" />
    </>)
    const checkbox = await screen.findByRole('checkbox', { name: /基準日を過ぎて7日経過/ })
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    fireEvent.click(checkbox)
    expect((checkbox as HTMLInputElement).checked).toBe(false)

    fireEvent.click(screen.getByRole('link', { name: '外の一覧へ' }))
    await screen.findByText('保存していない変更があります')
    expect(fixture.routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())
    // 編集を続けたので、外した停止条件が保たれる。
    expect((screen.getByRole('checkbox', { name: /基準日を過ぎて7日経過/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('破棄を選んだときだけ一覧へ進む', async () => {
    render(<>
      <a href="/reminders">外の一覧へ</a>
      <ReminderPublishFlow reminderId="rem-1" stage="target" />
    </>)
    const checkbox = await screen.findByRole('checkbox', { name: /基準日を過ぎて7日経過/ })
    fireEvent.click(checkbox)

    fireEvent.click(screen.getByRole('link', { name: '外の一覧へ' }))
    await screen.findByText('保存していない変更があります')

    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/reminders'))
  })

  it('変えていなければ確認を出さない', async () => {
    render(<ReminderPublishFlow reminderId="rem-1" stage="target" />)
    await screen.findByRole('checkbox', { name: /基準日を過ぎて7日経過/ })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
