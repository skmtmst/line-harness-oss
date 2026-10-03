import { describe, expect, it } from 'vitest'
import type { ReminderDraftSettings } from '@line-crm/shared'
import { describeReminderDiff } from './reminder-conflict-diff'

function settings(overrides: Partial<ReminderDraftSettings> = {}): ReminderDraftSettings {
  return {
    name: '予約前日のご案内',
    description: null,
    lineAccountId: 'acc-1',
    triggerType: 'booking',
    deliveryMode: 'countdown',
    triggerFieldId: null,
    triggerEventId: null,
    repeatYearly: false,
    triggerOffsetMinutes: -1440,
    sendAtTime: '18:00',
    targetTagId: null,
    targetCondition: null,
    folderId: null,
    stopConditions: { cancelOnVisit: false },
    steps: [{ offsetMinutes: -1440, messageContent: '明日です' }],
    ...overrides,
  } as ReminderDraftSettings
}

describe('リマインダの競合の違い比べ', () => {
  it('同じ内容なら行が出ない', () => {
    expect(describeReminderDiff(settings(), settings())).toEqual([])
  })

  it('名前・対象・手順・タイミングの違いを拾う', () => {
    const lines = describeReminderDiff(
      settings({
        name: '新しい名前',
        targetTagId: 'tag-1',
        steps: [],
        sendAtTime: '10:00',
      }),
      settings(),
    )
    expect(lines.some((line) => line.includes('リマインダ名'))).toBe(true)
    expect(lines.some((line) => line.includes('対象者と止める条件'))).toBe(true)
    expect(lines.some((line) => line.includes('通知の中身'))).toBe(true)
    expect(lines.some((line) => line.includes('タイミング'))).toBe(true)
  })
})
