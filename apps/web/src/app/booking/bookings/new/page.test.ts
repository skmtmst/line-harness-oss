import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const LIST = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../../../lib/api.ts', import.meta.url), 'utf8')
const SCHEDULE = readFileSync(new URL('./proxy-booking-schedule.ts', import.meta.url), 'utf8')
const BOOKING_TYPES = readFileSync(
  new URL('../../../../../../worker/src/services/booking-types.ts', import.meta.url),
  'utf8',
)
const BOOKING_CONFIRM = readFileSync(
  new URL('../../../../../../worker/src/services/booking-confirm.ts', import.meta.url),
  'utf8',
)

describe('V6 代理予約の接続契約', () => {
  test('入力・確認・完了・競合の実Nodeを同じフローで持つ', () => {
    for (const node of ['cpdDi', 'GFDqW', 'GfceK', 'Lg8ff']) {
      expect(PAGE).toContain(node)
    }
    expect(PAGE).toContain('data-qa-open="GFDqW"')
    expect(PAGE).toContain('data-qa-open="GfceK"')
  })

  test('一覧の作成操作は準備中ではなく代理予約へ進む', () => {
    expect(LIST).toContain('href="/booking/bookings/new"')
    expect(LIST).toContain('電話の予約を入れる')
    expect(LIST).not.toContain('管理画面から予約を代理で入れる仕組みは準備中です')
  })

  test('確定APIはIdempotency-Keyを必ず送る', () => {
    expect(API).toContain("headers: { 'Idempotency-Key': idempotencyKey }")
    expect(PAGE).toContain('crypto.randomUUID()')
  })

  test('予約日時からWorkerと同じ前日・2時間前の予定を計算し、過ぎた予定は出さない', () => {
    expect(SCHEDULE).toContain("{ label: '前日', minutesBefore: 24 * 60 }")
    expect(SCHEDULE).toContain("{ label: '開始2時間前', minutesBefore: 2 * 60 }")
    expect(SCHEDULE).toContain('if (scheduledAt <= now) return []')
    expect(PAGE).toContain("import { reminderScheduleLabels } from './proxy-booking-schedule'")
    expect(PAGE).toContain("reminderScheduleLabels(date, time).join(' ／ ')")
    expect(PAGE).not.toContain('前日19:00')
    expect(PAGE).not.toContain('当日8:00')
    expect(BOOKING_TYPES).toContain('reminder_hours_before: 2')
    expect(BOOKING_CONFIRM).toContain('args.startsAt.getTime() - 86400_000')
    expect(BOOKING_CONFIRM).toContain('args.startsAt.getTime() - hours * 3600_000')
    expect(BOOKING_CONFIRM).toContain('if (dayBefore > args.now)')
    expect(BOOKING_CONFIRM).toContain('if (hoursBefore > args.now)')
  })

  test('確認へ進む直前に同じ空き枠APIを読み直し、埋まった枠を確定候補にしない', () => {
    expect(PAGE).toContain('const latest = await bookingApi.getAvailability')
    expect(PAGE).toContain("slot.date === date && slot.start === time")
    expect(PAGE).toContain('data-booking-slot-check="available"')
    expect(PAGE).toContain('この日時は、確認画面を開く直前に空きを再確認しました。')
    expect(PAGE).toContain('空き時間を再確認できませんでした。状態を読み直して、もう一度お試しください。')
  })

  test('完了画面は作り物の成果数ではなく、実際に追加した予約台帳の1件を説明する', () => {
    expect(PAGE).toContain('1件追加（電話で受けた予約も同じ台帳へ記録します）')
    expect(PAGE).not.toContain('成果地点「予約が入った」を1件')
  })

  test('予約枠の競合を表示文言ではなく安全な機械コードで判定して選び直せる', () => {
    expect(PAGE).toContain('ApiError,')
    expect(PAGE).toContain('cause instanceof ApiError')
    expect(PAGE).toContain("cause.code === 'slot_conflict' || cause.code === 'slot_not_available'")
    expect(PAGE).toContain("setStep('conflict')")
    expect(PAGE).toContain('選んだ時間は、ほかの予約で埋まりました')
    expect(PAGE).toContain('予約を登録できませんでした。状態を確認して、もう一度お試しください。')
    expect(PAGE).not.toContain("message.includes('slot_conflict')")
    expect(PAGE).not.toContain('cause.status === 409 || cause.status === 422')
    expect(PAGE).not.toContain('API error:')
  })
})
