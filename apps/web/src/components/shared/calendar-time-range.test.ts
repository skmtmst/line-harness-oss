import { describe, expect, it } from 'vitest'
import { calendarInterval, calendarTimeRange } from './calendar-time-range'

describe('共通カレンダーの時刻範囲', () => {
  it('通常10時から20時を保ち、早朝と深夜を整数時刻へ広げる', () => {
    expect(calendarTimeRange([])).toEqual({ from: 10, to: 20 })
    expect(calendarTimeRange([{ start: '10:15', end: '19:30' }])).toEqual({ from: 10, to: 20 })
    expect(calendarTimeRange([{ start: '07:15', end: '07:45' }, { start: '20:45', end: '21:30' }])).toEqual({ from: 7, to: 22 })
    expect(calendarTimeRange([{ start: '00:00', end: '00:15' }, { start: '23:30', end: '24:00' }])).toEqual({ from: 0, to: 24 })
  })
  it('日ごとに区切られた半開区間だけを使い、不正な時刻で軸を壊さない', () => {
    for (const slot of [{ start: '99:00', end: '99:30' }, { start: '10:60', end: '11:00' }, { start: 'bad', end: '11:00' }, { start: '11:00', end: '10:00' }, { start: '24:00', end: '24:00' }]) {
      expect(calendarInterval(slot)).toBeNull()
      expect(calendarTimeRange([slot])).toEqual({ from: 10, to: 20 })
    }
    expect(calendarInterval({ start: '23:45', end: '24:00' })).toEqual({ start: 1425, end: 1440 })
  })
})
