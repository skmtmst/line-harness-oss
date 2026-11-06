// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderDraftSettings, ReminderValidationResult } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  audience: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn(), usePageCrumbs: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: { staff: { me: vi.fn(async () => ({ success: true, data: { role: 'owner' } })) }, reminders: { audience: fixture.audience } } }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', selectedAccount: { id: 'account-1', name: 'LINE' }, loading: false }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: null, enabled: () => false }),
}))
/*
 * 共通の条件部品そのものは別試験の守備範囲。ここでは「足す・消す」の
 * 操作口だけを stub にし、数え直し・顔ぶれの動きを確かめる。
 */
vi.mock('@/components/shared/condition-builder', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/shared/condition-builder')>()
  const Stub = ({ value, onChange }: {
    value: unknown
    onChange: (next: unknown) => void
  }) => (
    <div data-testid="condition-stub">
      <button type="button" onClick={() => onChange({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }], groups: [] })}>
        タグ条件を足す
      </button>
      <button type="button" onClick={() => onChange(null)}>
        条件を消す
      </button>
      <span data-testid="condition-value">{JSON.stringify(value)}</span>
    </div>
  )
  return { ...mod, default: Stub }
})

import { TargetStage } from '../../test-utils/reminder-stages'

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

const VALIDATION: ReminderValidationResult = {
  valid: true,
  checks: [],
  audience: { matched: 3, excluded: 1 },
}

const RECOUNT = {
  matched: 5,
  excluded: 2,
  sample: [
    { id: 'f-1', displayName: '山田花子' },
    { id: 'f-2', displayName: '佐藤太郎' },
  ],
}

function renderStage(settings: ReminderDraftSettings = SETTINGS, validation: ReminderValidationResult | null = VALIDATION) {
  const onChange = vi.fn()
  const view = render(
    <TargetStage
      reminderId="rem-1"
      settings={settings}
      validation={validation}
      onChange={onChange}
      onNext={() => {}}
      busy={false}
    />,
  )
  return {
    onChange,
    rerenderWith: (next: ReminderDraftSettings) => view.rerender(
      <TargetStage
        reminderId="rem-1"
        settings={next}
        validation={validation}
        onChange={onChange}
        onNext={() => {}}
        busy={false}
      />,
    ),
  }
}

const TAG_CONDITION = { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] } as const

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  fixture.audience.mockResolvedValue({ success: true, data: RECOUNT })
})

describe('対象ステージの条件編集と数え直し', () => {
  it('条件が空なら保存済みの人数を出し、数え直し口を叩かない', () => {
    renderStage()
    expect(screen.getByText('当てはまる人')).toBeTruthy()
    expect(screen.getByText('4 人')).toBeTruthy()
    expect(screen.getByText('3 人')).toBeTruthy()
    expect(screen.getByLabelText(/除く 1 人/)).toBeTruthy()
    expect(fixture.audience).not.toHaveBeenCalled()
    expect(screen.queryByTestId('condition-value')).toBeNull()
  })

  it('条件を足すと親へ返し、返ってきた条件で数え直す', async () => {
    const { onChange, rerenderWith } = renderStage()
    fireEvent.click(screen.getByRole('radio', { name: /条件に合う人だけ/ }))
    rerenderWith({ ...SETTINGS, targetCondition: { operator: 'AND', rules: [], groups: [] } })
    fireEvent.click(screen.getByRole('button', { name: 'タグ条件を足す' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        targetCondition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }], groups: [] },
      }),
    )
    // 親が新しい設定を返したら、その条件で数え直し口を叩く。
    rerenderWith({ ...SETTINGS, targetCondition: { ...TAG_CONDITION } })
    await waitFor(() => expect(fixture.audience).toHaveBeenCalledWith(
      'rem-1',
      { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }], groups: [] },
    ))
  })

  it('数え直した人数で当てはまる・送る予定・除くを出す', async () => {
    renderStage(
      { ...SETTINGS, targetCondition: { ...TAG_CONDITION } },
      VALIDATION,
    )
    // 数えている間は「数えています」と出す。
    expect(screen.getAllByText('… 人').length).toBe(2)
    await waitFor(() => expect(screen.getByText('7 人')).toBeTruthy())
    expect(screen.getByText('5 人')).toBeTruthy()
    expect(screen.getByLabelText(/除く 2 人/)).toBeTruthy()
  })

  it('数え直しに失敗したら文で知らせ、数え直せる', async () => {
    fixture.audience.mockResolvedValue({ success: false, error: '対象者を数え直せませんでした' })
    renderStage(
      { ...SETTINGS, targetCondition: { ...TAG_CONDITION } },
      VALIDATION,
    )
    await waitFor(() => expect(screen.getByText(/対象者を数え直せませんでした/)).toBeTruthy())
    // 保存済みの人数は残す。失敗した試算を 0人と見せない。
    expect(screen.getByText('3 人')).toBeTruthy()
    fixture.audience.mockResolvedValue({ success: true, data: RECOUNT })
    fireEvent.click(screen.getByRole('button', { name: '数え直す' }))
    await waitFor(() => expect(screen.getByText('5 人')).toBeTruthy())
  })

  it('顔ぶれを見ると数え直した先頭が出る', async () => {
    renderStage(
      { ...SETTINGS, targetCondition: { ...TAG_CONDITION } },
      VALIDATION,
    )
    await waitFor(() => expect(screen.getByText('5 人')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '顔ぶれを見る' }))
    expect(screen.getByText('対象者を確認')).toBeTruthy()
    expect(screen.getByText('山田花子')).toBeTruthy()
    expect(screen.getByText('佐藤太郎')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    await waitFor(() => expect(screen.queryByText('対象者を確認')).toBeNull())
  })

  it('条件を消すと保存済みの人数に戻り、口を叩かない', async () => {
    const { rerenderWith } = renderStage(
      { ...SETTINGS, targetCondition: { ...TAG_CONDITION } },
      VALIDATION,
    )
    await waitFor(() => expect(screen.getByText('5 人')).toBeTruthy())
    expect(fixture.audience).toHaveBeenCalledTimes(1)
    // 親が空の条件を返したら、数え直しは消えて保存済みの人数に戻る。
    rerenderWith({ ...SETTINGS, targetCondition: null })
    await waitFor(() => expect(screen.getByText('3 人')).toBeTruthy())
    expect(fixture.audience).toHaveBeenCalledTimes(1)
  })
})
