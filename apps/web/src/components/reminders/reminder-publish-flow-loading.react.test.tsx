// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderDraftSettings, ReminderDraftVersion, ReminderValidationResult } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  getDraft: vi.fn(),
  validateDraft: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/api', () => ({ api: { reminders: { getDraft: fixture.getDraft, validateDraft: fixture.validateDraft } } }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: null, enabled: () => false }),
}))
/*
 * 条件部品そのものは別試験の守備範囲。ここでは読み込み失敗の表示だけを
 * 確かめるので、条件の選択肢取得を stub にする。
 */
vi.mock('@/components/shared/condition-builder', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/shared/condition-builder')>()
  const Stub = () => <div data-testid="condition-stub" />
  return { ...mod, default: Stub }
})

import ReminderPublishFlow from './reminder-publish-flow'

const SETTINGS: ReminderDraftSettings = {
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
  targetCondition: null,
  folderId: null,
  stopConditions: {
    bookingCancelled: true,
    supportMarkCompleted: false,
    daysAfterTarget: 7,
    friendBlocked: true,
  },
  steps: [
    { stableStepId: 'step-1', offsetMinutes: -60, messageType: 'text', messageContent: '予約の1時間前です', offsetDays: null, sendAtTime: null, templateId: null },
  ],
}

const DRAFT: ReminderDraftVersion = {
  reminderId: 'rem-1',
  versionId: 'ver-1',
  versionNumber: 2,
  status: 'draft',
  settings: SETTINGS,
  lastTestStatus: 'succeeded',
  lastTestedAt: '2026-09-10T03:00:00.000Z',
  publishedAt: null,
}

const VALIDATION: ReminderValidationResult = {
  valid: true,
  checks: [],
  audience: { matched: 3, excluded: 1 },
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  fixture.validateDraft.mockResolvedValue({ success: true, data: VALIDATION })
})

describe('対象フローの読み込み失敗表示', () => {
  it('別IDの下書きが返っても読み込み中のままにせず、再読み込みを出す', async () => {
    // 司令塔の撮影：reminder-1 で開いたのに reminder-3 の下書きが返る。
    fixture.getDraft.mockResolvedValue({ success: true, data: { ...DRAFT, reminderId: 'reminder-3' } })
    render(<ReminderPublishFlow reminderId="rem-1" stage="target" />)
    await waitFor(() => expect(screen.getByText('下書きを表示できませんでした')).toBeTruthy())
    expect(screen.queryByText('下書きを読み込んでいます')).toBeNull()
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy()
  })

  it('読み込み失敗は共通の失敗表示になり、再読み込みで直る', async () => {
    fixture.getDraft
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ success: true, data: DRAFT })
    render(<ReminderPublishFlow reminderId="rem-1" stage="target" />)
    await waitFor(() => expect(screen.getByText('下書きを表示できませんでした')).toBeTruthy())
    expect(screen.queryByText('下書きを読み込んでいます')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    await waitFor(() => expect(screen.getByText('対象者の条件')).toBeTruthy())
    expect(fixture.getDraft).toHaveBeenCalledTimes(2)
  })
})
