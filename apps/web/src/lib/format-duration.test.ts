import { describe, expect, it } from 'vitest'
import { formatDurationMinutes, formatElapsedMinutes, formatHoursBeforeHint, formatMinutesLengthHint, formatMinutesRough, formatTimeSpan, formatWaitRough } from './format-duration'

describe('共通の経過時間と長さ', () => {
  it.each([[59, '59分'], [60, '1時間'], [47 * 60 + 59, '47時間'], [48 * 60, '2日']])('%i分は%s', (minutes, expected) => {
    expect(formatTimeSpan(minutes)).toBe(expected)
  })
  it('1分未満は「たった今」、数と単位の間隔も選べる', () => {
    expect(formatElapsedMinutes(0.5)).toBe('たった今')
    expect(formatTimeSpan(59, { gap: true })).toBe('59 分')
    expect(formatWaitRough(47 * 60 + 59)).toBe('47時間前')
    expect(formatWaitRough(48 * 60)).toBe('2日前')
    expect(formatElapsedMinutes(Number.NaN)).toBe('—')
  })
})

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

/* 経過・待ち・平均の長さを、分・時間・48時間を超えたら日に統一する。 */
describe('formatMinutesRough', () => {
  it.each([
    [0, '0分'],
    [1, '1分'],
    [59, '59分'],
    [60, '1時間'],
    [61, '1時間'],
    [90, '1時間'],
    [1_439, '23時間'],
    [1_440, '24時間'],
    [1_441, '24時間'],
    [43_199, '29日'],
    [43_200, '30日'],
    [43_201, '30日'],
    [55_975, '38日'],
    [86_400, '60日'],
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
