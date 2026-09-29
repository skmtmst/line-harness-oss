import { describe, expect, it } from 'vitest'
import { formatTriggerOffset } from './reminder-timing'

/** #489-21：後の通知が「前」と誤表示されないこと。 */
describe('formatTriggerOffset', () => {
  it('未設定・0・1時間未満は「当日」', () => {
    expect(formatTriggerOffset(null)).toBe('当日')
    expect(formatTriggerOffset(undefined)).toBe('当日')
    expect(formatTriggerOffset(0)).toBe('当日')
    expect(formatTriggerOffset(-30)).toBe('当日')
    expect(formatTriggerOffset(30)).toBe('当日')
  })

  it('負の差は「前」、正の差は「後」', () => {
    expect(formatTriggerOffset(-1440)).toBe('1日前')
    expect(formatTriggerOffset(-120)).toBe('2時間前')
    expect(formatTriggerOffset(1440)).toBe('1日後')
    expect(formatTriggerOffset(90)).toBe('2時間後')
  })
})
