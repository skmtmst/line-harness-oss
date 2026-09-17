// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReminderDraftSettings, ReminderDraftVersion, ReminderPreviewResult, ReminderValidationResult } from '@line-crm/shared'

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/api', () => ({ api: { reminders: {} } }))

import { ConfirmStage, DoneStage, PreviewStage, TestStage } from './reminder-publish-flow'

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
  folderId: null,
  stopConditions: {
    bookingCancelled: true,
    supportMarkCompleted: false,
    daysAfterTarget: 7,
    friendBlocked: true,
  },
  steps: [
    { stableStepId: 'step-1', offsetMinutes: 0, messageType: 'text', messageContent: '{{name}}さん、明日のご相談のご案内です。', offsetDays: -1, sendAtTime: '18:00', templateId: null },
    { stableStepId: 'step-2', offsetMinutes: -60, messageType: 'text', messageContent: 'まもなく開始です。', offsetDays: 0, sendAtTime: '09:00', templateId: null },
    { stableStepId: 'step-3', offsetMinutes: -60, messageType: 'text', messageContent: '直前の確認です。', offsetDays: 0, sendAtTime: '09:00', templateId: null },
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
  checks: [{ key: 'audience', label: '対象者', status: 'passed', message: '' }],
  audience: { matched: 3, excluded: 1 },
}

const DAY = 86_400_000
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()
const DUPLICATE_AT = inDays(2)

const PREVIEW: ReminderPreviewResult = {
  targetDate: inDays(3),
  items: [
    { stableStepId: 'step-1', stepNumber: 1, scheduledAt: inDays(1), label: '-1日 18:00', state: 'scheduled' },
    { stableStepId: 'step-2', stepNumber: 2, scheduledAt: DUPLICATE_AT, label: '当日 09:00', state: 'duplicate' },
    { stableStepId: 'step-3', stepNumber: 3, scheduledAt: DUPLICATE_AT, label: '当日 09:00', state: 'duplicate' },
  ],
  summary: { audience: 42, next7Days: 126, next30Days: 126, duplicateCount: 1 },
}

afterEach(cleanup)

describe('リマインダ公開フローの実データ表示', () => {
  it('PreviewStage はAPIの対象者数を各行へ出し、固定人数を出さない', () => {
    render(<PreviewStage settings={SETTINGS} preview={PREVIEW} onNext={() => {}} />)
    // 各行の対象はAPIの matched を使う（全ステップ同じ対象）。
    expect(screen.getAllByText('42人').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('71人')).toBeNull()
    expect(screen.queryByText('82人')).toBeNull()
    expect(screen.queryByText('2人が重複')).toBeNull()
    // 重複は「人が重複」ではなく同時刻の通知件数として出す。
    expect(screen.getAllByText('同時刻に2件').length).toBe(2)
  })

  it('PreviewStage の絞り込みボタンは表示行を実際に変える', () => {
    const { container } = render(<PreviewStage settings={SETTINGS} preview={PREVIEW} onNext={() => {}} />)
    const rowCount = () => container.querySelectorAll('tbody tr').length
    expect(rowCount()).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: '競合のみ' }))
    expect(rowCount()).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: '今後30日' }))
    expect(rowCount()).toBe(3)
  })

  it('PreviewStage は重複が無いとき「無い」と明示し、0件と未取得を混ぜない', () => {
    const clean: ReminderPreviewResult = { ...PREVIEW, items: PREVIEW.items.slice(0, 1), summary: { ...PREVIEW.summary, duplicateCount: 0 } }
    render(<PreviewStage settings={SETTINGS} preview={clean} onNext={() => {}} />)
    expect(screen.getByText('重複している送信予定はありません。')).toBeTruthy()
    expect(screen.getByText('0件')).toBeTruthy()
  })

  it('PreviewStage は未取得の間は確認中とし、0件と混ぜない', () => {
    render(<PreviewStage settings={SETTINGS} preview={null} onNext={() => {}} />)
    expect(screen.getAllByText('—人').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('0人')).toBeNull()
  })

  it('ConfirmStage は予定通知数を対象×通数で出し、固定の1,194通を出さない', () => {
    render(<ConfirmStage draft={DRAFT} settings={SETTINGS} validation={VALIDATION} onPublish={() => {}} busy={false} />)
    // matched 3人 × 3通 = 9通。
    expect(screen.getAllByText('9通').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('1,194通')).toBeNull()
    // 実装の無いSlack通知は約束しない。
    expect(screen.queryByText(/Slack/)).toBeNull()
    // 基準日・停止条件・通知ステップは設定の実値。
    expect(screen.getAllByText('予約日時').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/基準日から7日後に自動終了/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/1日前の18:00/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('前日・1時間前・当日')).toBeNull()
  })

  it('TestStage は本文の実差し込みだけを並べ、実装に無い変数名を出さない', () => {
    render(<TestStage draft={DRAFT} recipientName="山田 花子" onConfirm={() => {}} onNext={() => {}} />)
    expect(screen.getByText('{{name}}')).toBeTruthy()
    expect(screen.getAllByText('山田 花子').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/meet_datetime/)).toBeNull()
    expect(screen.queryByText(/meet_url/)).toBeNull()
    expect(screen.queryByText(/meet\.google\.com/)).toBeNull()
    // フッターは下書きの実テスト記録を見る。
    expect(screen.getByText(/テスト済み 2026\/09\/10/)).toBeTruthy()
    expect(screen.queryByText(/2026\/09\/06/)).toBeNull()
  })

  it('DoneStage の主ボタンは詳細画面への実リンクで、Slackを約束しない', () => {
    render(<DoneStage draft={DRAFT} published={{ reminderId: 'rem-1', versionId: 'ver-2', versionNumber: 2, publishedAt: '2026-09-10T04:00:00.000Z', audience: 3, plannedDeliveries: 9, nextScheduledAt: inDays(1) }} preview={PREVIEW} validation={VALIDATION} />)
    const link = screen.getByText('通知予定を確認').closest('a')
    expect(link?.getAttribute('href')).toBe('/reminders/detail?id=rem-1')
    expect(screen.queryByText(/Slack/)).toBeNull()
    expect(screen.getByText(/送信の状況と今後の予定は詳細画面で/)).toBeTruthy()
    // 通知ステップは設定の実値。
    expect(screen.getAllByText(/1日前の18:00/).length).toBeGreaterThanOrEqual(1)
  })
})
