import { describe, expect, test } from 'vitest'
import { reminderScheduleLabels } from './proxy-booking-schedule'

describe('代理予約のリマインド予定', () => {
  test('前日と開始2時間前を日本時間で表示する', () => {
    expect(reminderScheduleLabels('2026-09-02', '11:00', new Date('2026-08-30T00:00:00Z')))
      .toEqual(['前日：9月1日(火) 11:00', '開始2時間前：9月2日(水) 09:00'])
  })

  test('Workerが登録しない過去の予定は表示しない', () => {
    expect(reminderScheduleLabels('2026-09-02', '11:00', new Date('2026-09-01T12:00:00Z')))
      .toEqual(['開始2時間前：9月2日(水) 09:00'])
  })

  test('日時が欠けていると作り物の予定を返さない', () => {
    expect(reminderScheduleLabels('', '')).toEqual([])
  })
})
