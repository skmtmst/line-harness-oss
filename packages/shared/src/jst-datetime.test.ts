import { afterEach, expect, test, vi } from 'vitest'
import { jstDate, jstCalendar, jstDayStartIso, jstMonthStart, jstDateTimeLocal, jstDateOffset, jstMonthRange, jstTimestamp, isCalendarDate } from './jst-datetime'
afterEach(() => vi.useRealTimers())
test.each(['UTC', 'Pacific/Honolulu'])('全アプリで%sの時計でも日本の00:09を当日と扱う', timezone => {
  const previous = process.env.TZ
  process.env.TZ = timezone
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T15:09:00Z'))
  try {
    expect(jstDate()).toBe('2026-10-11')
    expect(jstDateOffset(-1)).toBe('2026-10-10')
    expect(jstDateTimeLocal()).toBe('2026-10-11T00:09')
    expect(jstDayStartIso()).toBe('2026-10-10T15:00:00.000Z')
    expect(jstCalendar().getUTCHours()).toBe(0)
    expect(jstCalendar().getUTCMinutes()).toBe(9)
    expect(jstMonthStart(new Date('2026-09-30T15:09:00Z'))).toBe('2026-10-01')
    expect(jstMonthRange(new Date('2026-09-30T15:09:00Z'))).toEqual({ periodFrom: '2026-09-30T15:00:00.000Z', periodTo: '2026-10-31T14:59:59.999Z' })
  } finally {
    if(previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test.each([['2026-02-30', false], ['2026-02-29', false], ['2028-02-29', true], ['2026-04-31', false], ['2026-12-31', true], ['2026-13-01', false], [null, false]])('実在する暦日を共通で検査する: %s', (date, valid) => { expect(isCalendarDate(date)).toBe(valid) })


test.each([
  ['2026-09-30T14:59:59.999Z', '2026-09-30', '23:59'],
  ['2026-09-30T15:00:00.000Z', '2026-10-01', '00:00'],
  ['2026-09-30T23:59:59.999Z', '2026-10-01', '08:59'],
  ['2026-10-01T00:00:00.000Z', '2026-10-01', '09:00'],
  ['2026-12-31T15:00:00.000Z', '2027-01-01', '00:00'],
  ['2028-02-28T15:00:00.000Z', '2028-02-29', '00:00'],
])('日本の暦日と壁時刻は月・年・うるう日の境目で一致する: %s', (iso, date, time) => {
  expect(jstDate(new Date(iso))).toBe(date)
  expect(jstDateTimeLocal(new Date(iso))).toBe(`${date}T${time}`)
})


test('保存する日本時間ISOは瞬間とミリ秒を保つ', () => {
  const date = new Date('2026-09-30T15:00:00.123Z')
  expect(jstTimestamp(date)).toBe('2026-10-01T00:00:00.123+09:00')
  expect(Date.parse(jstTimestamp(date))).toBe(date.getTime())
})
