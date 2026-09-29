/*
 * DETAIL-10: 編集画面の枠一覧でも、日をまたぐ枠は終了側の日付を出す。
 *
 * 以前は終了が常に時刻だけ(`〜 01:00`)で、翌日にまたがる枠の終了日が
 * 読めなかった。実行環境のタイムゾーンに左右されない入力で試す。
 */
import { describe, expect, it, vi } from 'vitest'

import { formatJpDateTime, formatJpSlotRange } from './event-form'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

describe('formatJpSlotRange', () => {
  it('同じ日の枠は終了を時刻だけで出す', () => {
    // UTC 03:00〜05:00 は、どの実用タイムゾーンでも同じ日に収まる
    const startsAt = '2026-09-20T03:00:00.000Z'
    const endsAt = '2026-09-20T05:00:00.000Z'
    expect(formatJpSlotRange(startsAt, endsAt)).toBe(
      `${formatJpDateTime(startsAt)} 〜 ${formatJpDateTime(endsAt).slice(-5)}`,
    )
  })

  it('日をまたぐ枠は終了側の日付も出す', () => {
    // 48時間の枠。どのタイムゾーンでも開始日と終了日は必ず違う日になる
    const startsAt = '2026-09-20T00:00:00.000Z'
    const endsAt = '2026-09-22T00:00:00.000Z'
    const out = formatJpSlotRange(startsAt, endsAt)
    expect(out).toBe(`${formatJpDateTime(startsAt)} 〜 ${formatJpDateTime(endsAt)}`)
    // 終了側に日付が残っていること（時刻だけでないこと）
    expect(out).toContain(formatJpDateTime(endsAt).slice(0, 10))
  })
})
