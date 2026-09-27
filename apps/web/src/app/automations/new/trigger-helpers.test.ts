import { describe, expect, it } from 'vitest'
import {
  friendNamesOf,
  nextWeeklyRunText,
  normalizeFriendIds,
  normalizeWeekdays,
  weekdayNames,
} from './trigger-helpers'

/*
 * R21: "1,3," は [1,3] になり、0（日曜）は足さない。
 * 空の要素を数値化する前の形へ戻すと赤くなる。
 */
describe('毎週の曜日の正規化（R21）', () => {
  it('余分なカンマを日曜に変えない', () => {
    expect(normalizeWeekdays('1,3,')).toEqual([1, 3])
    expect(normalizeWeekdays('1,3,')).not.toContain(0)
    expect(normalizeWeekdays(',')).toEqual([])
    expect(normalizeWeekdays('')).toEqual([])
  })

  it('0〜6の整数だけを小さい順に並べる', () => {
    expect(normalizeWeekdays([3, 1])).toEqual([1, 3])
    expect(normalizeWeekdays([1, 1, 3])).toEqual([1, 3])
    expect(normalizeWeekdays(' 2 , 0 ')).toEqual([0, 2])
  })

  it('文字・小数・範囲外は捨てる', () => {
    expect(normalizeWeekdays(['1', 'x', ''])).toEqual([1])
    expect(normalizeWeekdays([1, 3.5])).toEqual([1])
    expect(normalizeWeekdays([1, 7])).toEqual([1])
    expect(normalizeWeekdays([-1, 3])).toEqual([3])
    expect(normalizeWeekdays(undefined)).toEqual([])
  })

  it('日曜（0）を選んだときだけ0が入る', () => {
    expect(normalizeWeekdays([0])).toEqual([0])
    expect(normalizeWeekdays('0')).toEqual([0])
  })

  it('人の言葉と次の日時に直せる', () => {
    expect(weekdayNames([3, 1])).toBe('月・水')
    expect(weekdayNames([])).toBe('')
    expect(nextWeeklyRunText([], '09:00')).toBeNull()
    expect(nextWeeklyRunText([1], '')).toBeNull()
    const next = nextWeeklyRunText([0, 1, 2, 3, 4, 5, 6], '09:00')
    expect(next).toMatch(/^\d+\/\d+（[日月火水木金土]）9:00$/)
  })
})

/* R22: 空・重複を落とし、100人で切る。 */
describe('対象の友だちの正規化（R22）', () => {
  it('空の要素と重複を落とす', () => {
    expect(normalizeFriendIds('a,,b,a')).toEqual(['a', 'b'])
    expect(normalizeFriendIds(['a', ' a ', ''])).toEqual(['a'])
    expect(normalizeFriendIds(undefined)).toEqual([])
  })

  it('100人で切る', () => {
    const many = Array.from({ length: 120 }, (_, index) => `friend-${index}`)
    expect(normalizeFriendIds(many)).toHaveLength(100)
  })

  it('表示用の名前だけを取り出す', () => {
    expect(friendNamesOf({ friendIds: ['a'], friendNames: { a: '山田' } })).toEqual({ a: '山田' })
    expect(friendNamesOf({})).toEqual({})
    expect(friendNamesOf({ friendNames: '山田' })).toEqual({})
  })
})
