import { describe, expect, it } from 'vitest'
import { formatDurationMinutes, formatHoursBeforeHint, formatMinutesLengthHint, formatMinutesRough } from './format-duration'

describe('formatDurationMinutes', () => {
  it.each([
    [0, '0分'],
    [59, '59分'],
    [60, '1時間'],
    [61, '1時間1分'],
    [1_440, '1日'],
    [1_500, '1日1時間'],
    [11_121, '7日17時間21分'],
    [11_143, '7日17時間43分'],
  ])('%i分を%sで表示する', (minutes, expected) => {
    expect(formatDurationMinutes(minutes)).toBe(expected)
  })
})

/*
 * Issue #666: 審査の「1枚にかかる時間」は分の生値（平均55975分≒38.8日）で
 * 出ていた。60分以上は「約○時間」、24時間以上は「約○日」、30日以上は
 * 「約○ヶ月」と、眺める画面で読める単位へ切り替える。
 */
describe('formatMinutesRough', () => {
  it.each([
    [0, '0分'],
    [1, '1分'],
    [59, '59分'],
    [60, '約1時間'],
    [61, '約1時間'],
    [90, '約2時間'],
    [1_439, '約24時間'],
    [1_440, '約1日'],
    [1_441, '約1日'],
    [43_199, '約30日'],
    [43_200, '約30日'],
    [43_201, '約1ヶ月'],
    // Issue #666 の実測値: 平均 55975分 ≒ 38.8日。
    [55_975, '約1ヶ月'],
    [86_400, '約2ヶ月'],
  ])('%i分を%sで表示する', (minutes, expected) => {
    expect(formatMinutesRough(minutes)).toBe(expected)
  })
})

/*
 * Issue #710: 仮押さえの保持時間は「1440分」の生値で出ていた。
 * 入力の横に置く読み替え（「〜前」を付けない長さ）。60分未満は
 * 分のままが一番読みやすいので読み替えを返さない。
 */
describe('formatMinutesLengthHint', () => {
  it.each([
    [1_440, '1日'],
    [90, '1時間30分'],
    [60, '1時間'],
  ])('%i分を%sと読み替える', (minutes, expected) => {
    expect(formatMinutesLengthHint(minutes)).toBe(expected)
  })

  it.each([0, 30, 59])('%i分は読み替えを出さない', (minutes) => {
    expect(formatMinutesLengthHint(minutes)).toBeNull()
  })
})

/*
 * Issue #710: 当日のお知らせは「72時間前」の生値で出ていた。
 * 24時間の倍数のときだけ「N日前」に読み替える。
 */
describe('formatHoursBeforeHint', () => {
  it.each([
    [24, '1日前'],
    [48, '2日前'],
    [72, '3日前'],
  ])('%i時間前を%sと読み替える', (hours, expected) => {
    expect(formatHoursBeforeHint(hours)).toBe(expected)
  })

  it.each([1, 2, 25, 47])('%i時間前は読み替えを出さない', (hours) => {
    expect(formatHoursBeforeHint(hours)).toBeNull()
  })
})
