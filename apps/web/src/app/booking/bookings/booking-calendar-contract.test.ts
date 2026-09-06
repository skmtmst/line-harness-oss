import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const CALENDAR = readFileSync(new URL('./booking-calendar.tsx', import.meta.url), 'utf8')
const CREATE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')

describe('V6 予約管理の時間台帳', () => {
  test('今日・今週・今月・一覧を実際に切り替えられる', () => {
    expect(PAGE).toContain("useState<'day' | 'week' | 'month' | 'list'>('day')")
    for (const label of ['今日', '今週', '今月', '一覧']) expect(PAGE).toContain(label)
    expect(PAGE).toContain('onClick={() => setView(key)}')
  })

  test('今日を時間×担当、今週を時間×曜日の格子で表示する', () => {
    expect(CALENDAR).toContain('function DayGrid')
    expect(CALENDAR).toContain('function WeekGrid')
    expect(CALENDAR).toContain('repeat(${Math.max(staff.length, 1)}, minmax(0, 1fr))')
    expect(CALENDAR).toContain("'64px repeat(7, minmax(0, 1fr))'")
    expect(CALENDAR).toContain('LINEからの予約（緑）と電話の予約（青）')
  })

  test('電話予約はLINE予約と同じ格子へ出し、未連携の理由も隠さない', () => {
    expect(CALENDAR).toContain('function isPhoneBooking')
    expect(CALENDAR).toContain("!booking.friend_id")
    expect(CALENDAR).toContain('電話予約のお客さま')
    expect(CALENDAR).toContain('LINE未連携の方には当日の連絡ができません。')
  })

  test('代理予約入力は設計の案内・プレビュー・連携先を持つ', () => {
    for (const text of [
      'LINEの友だちなら、名前で探して結びつけてください。',
      'お客様に何を送りますか',
      'LINEプレビュー',
      'この方について',
      'つながる先',
    ]) expect(CREATE).toContain(text)
    expect(CREATE).toContain('顧客台帳の受け皿ができるまで登録できません')
  })
})
