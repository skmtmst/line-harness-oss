// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderDraftSettings, ReminderValidationResult } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  audience: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/api', () => ({ api: { reminders: { audience: fixture.audience } } }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
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

import { TargetStage } from './reminder-publish-flow'

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
    expect(screen.getByText('当てはまる')).toBeTruthy()
    expect(screen.getAllByText('4人').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('3人').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('除く')).toBeTruthy()
    expect(fixture.audience).not.toHaveBeenCalled()
    expect(screen.getByTestId('condition-value').textContent).toBe('null')
  })

  it('条件を足すと親へ返し、返ってきた条件で数え直す', async () => {
    const { onChange, rerenderWith } = renderStage()
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
    expect(screen.getByText('数えています…')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('7人').length).toBeGreaterThanOrEqual(1))
    expect(screen.getAllByText('5人').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('2人').length).toBeGreaterThanOrEqual(1)
  })

  it('数え直しに失敗したら文で知らせ、数え直せる', async () => {
    fixture.audience.mockResolvedValue({ success: false, error: '対象者を数え直せませんでした' })
    renderStage(
      { ...SETTINGS, targetCondition: { ...TAG_CONDITION } },
      VALIDATION,
    )
    await waitFor(() => expect(screen.getByText(/対象者を数え直せませんでした/)).toBeTruthy())
    // 保存済みの人数は残す。失敗した試算を 0人と見せない。
    expect(screen.getAllByText('3人').length).toBeGreaterThanOrEqual(1)
    fixture.audience.mockResolvedValue({ success: true, data: RECOUNT })
    fireEvent.click(screen.getByRole('button', { name: '数え直す' }))
    await waitFor(() => expect(screen.getAllByText('5人').length).toBeGreaterThanOrEqual(1))
  })

  it('顔ぶれを見ると数え直した先頭が出る', async () => {
    renderStage(
      { ...SETTINGS, targetCondition: { ...TAG_CONDITION } },
      VALIDATION,
    )
    await waitFor(() => expect(screen.getAllByText('5人').length).toBeGreaterThanOrEqual(1))
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
    await waitFor(() => expect(screen.getAllByText('5人').length).toBeGreaterThanOrEqual(1))
    expect(fixture.audience).toHaveBeenCalledTimes(1)
    // 親が空の条件を返したら、数え直しは消えて保存済みの人数に戻る。
    rerenderWith({ ...SETTINGS, targetCondition: null })
    await waitFor(() => expect(screen.getAllByText('3人').length).toBeGreaterThanOrEqual(1))
    expect(fixture.audience).toHaveBeenCalledTimes(1)
  })
})
