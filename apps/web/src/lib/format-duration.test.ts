import { describe, expect, it } from 'vitest'
import { formatDurationMinutes } from './format-duration'

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
