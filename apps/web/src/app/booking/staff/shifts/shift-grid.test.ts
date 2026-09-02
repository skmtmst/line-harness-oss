import { describe, expect, it } from 'vitest'
import { GRID_DAYS, gridHours, isOpenAt, specialCountByDay, type WeeklyTemplate } from './shift-grid'

const empty = Object.fromEntries(GRID_DAYS.map((d) => [d.key, null])) as WeeklyTemplate
const week = (over: Partial<WeeklyTemplate> = {}): WeeklyTemplate => ({ ...empty, ...over })

describe('格子に出す時間帯', () => {
  it('受け付ける時間が入っている幅だけを出す', () => {
    // 0時から23時まで並べると、ほとんど空の格子になって読みにくい。
    expect(gridHours(week({ mon: { start: '10:00', end: '19:00' } }))).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('曜日をまたいで一番広いところに合わせる', () => {
    const h = gridHours(week({ mon: { start: '10:00', end: '12:00' }, sat: { start: '08:00', end: '20:00' } }))
    expect(h[0]).toBe(8)
    expect(h[h.length - 1]).toBe(19)
  })

  it('端数の時間も切り上げて入れる', () => {
    expect(gridHours(week({ mon: { start: '10:30', end: '11:30' } }))).toEqual([10, 11])
  })

  it('1日も受け付けないなら空', () => {
    expect(gridHours(empty)).toEqual([])
  })

  it('壊れた時刻や逆転した時間帯は数に入れない', () => {
    expect(gridHours(week({ mon: { start: 'あ', end: '19:00' } }))).toEqual([])
    expect(gridHours(week({ mon: { start: '19:00', end: '10:00' } }))).toEqual([])
    expect(gridHours(week({ mon: { start: '25:00', end: '26:00' } }))).toEqual([])
  })
})

describe('受け付ける時間', () => {
  const hours = { start: '10:00', end: '19:00' }

  it('開始ちょうどは入り、終了ちょうどは入らない', () => {
    expect(isOpenAt(hours, 10)).toBe(true)
    expect(isOpenAt(hours, 18)).toBe(true)
    expect(isOpenAt(hours, 19)).toBe(false)
    expect(isOpenAt(hours, 9)).toBe(false)
  })

  it('受け付けない曜日は常に false', () => {
    expect(isOpenAt(null, 12)).toBe(false)
  })

  it('30分単位でも、かかっている時間は入れる', () => {
    expect(isOpenAt({ start: '10:30', end: '11:30' }, 10)).toBe(true)
    expect(isOpenAt({ start: '10:30', end: '11:30' }, 11)).toBe(true)
    expect(isOpenAt({ start: '10:30', end: '11:30' }, 12)).toBe(false)
  })
})

describe('特別な日', () => {
  it('曜日ごとに数える', () => {
    // 2026-09-07 は月曜。
    const counts = specialCountByDay([{ work_date: '2026-09-07' }, { work_date: '2026-09-14' }])
    expect(counts.mon).toBe(2)
    expect(counts.tue).toBe(0)
  })

  it('読めない日付は数に入れない', () => {
    expect(specialCountByDay([{ work_date: 'あした' }]).mon).toBe(0)
  })

  it('休みか営業かを決めつけない', () => {
    /*
      画面の見出しは「特別な休み・営業」で、開ける日も閉める日も同じ表に入る。
      どちらかは口が言っていないので、件数だけを返す。
    */
    const counts = specialCountByDay([{ work_date: '2026-09-07' }])
    expect(typeof counts.mon).toBe('number')
  })
})

describe('曜日の出し方', () => {
  it('見ている人の時計で曜日がずれない', () => {
    /*
      日付は暦の日で、時刻も時差も持っていない。`getDay()` を使うと
      時差のある場所から見て1日ずれる（開発機がUTC+7で月曜が日曜に化けた）。
    */
    const counts = specialCountByDay([{ work_date: '2026-09-07' }])
    expect(counts.mon).toBe(1)
    expect(counts.sun).toBe(0)
  })
})
