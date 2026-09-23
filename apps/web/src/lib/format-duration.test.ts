import { describe, expect, it } from 'vitest'
import { formatDurationMinutes, formatMinutesRough } from './format-duration'

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
