import { describe, expect, it } from 'vitest'
import type { BookingAvailabilitySlot } from '@/lib/api'
import { mergeStaffSlots } from './preview-slots'

const slot = (date: string, start: string, remaining: number): BookingAvailabilitySlot =>
  ({ date, start, end: start, capacity: 2, remaining, state: remaining > 0 ? 'limited' : 'full' }) as BookingAvailabilitySlot

describe('右のスマホの「指名なし」の空き', () => {
  it('担当ごとの枠を日時でまとめ、だれか1人でも空いていれば空きにする', () => {
    const merged = mergeStaffSlots([
      { slots: [slot('2026-10-02', '13:00', 0), slot('2026-10-02', '09:00', 1)] },
      { slots: [slot('2026-10-02', '13:00', 1), slot('2026-10-01', '10:00', 1)] },
    ])
    expect(merged.map((s) => `${s.date} ${s.start} ${s.remaining}`)).toEqual([
      '2026-10-01 10:00 1',
      '2026-10-02 09:00 1',
      '2026-10-02 13:00 1',
    ])
  })

  it('枠の無い担当がいても落ちない', () => {
    expect(mergeStaffSlots([{}, { slots: [] }])).toEqual([])
  })
})
