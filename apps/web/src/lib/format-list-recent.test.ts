import { describe, expect, it } from 'vitest'
import { formatListRecent, formatListRecentTitle } from './format'

// 日曜の 17:51（日本時間）
const NOW = new Date('2026-10-25T08:51:00Z')

describe('一覧の短い時刻（今日は時刻・6日前までは曜日・前は日付）', () => {
  it('今日は時刻だけ', () => {
    expect(formatListRecent('2026-10-25T08:48:00Z', { now: NOW })).toBe('17:48')
    expect(formatListRecent('2026-10-24T15:05:00Z', { now: NOW })).toBe('00:05')
  })
  it('日本時間の前の日は「昨日」（UTC では同じ日でも）', () => {
    // 日本時間の土曜 23:30（UTC では土曜 14:30）
    expect(formatListRecent('2026-10-24T14:30:00Z', { now: NOW })).toBe('昨日')
  })
  it('6日前までは曜日、7日前からは月/日', () => {
    // 3日さかのぼると木曜
    expect(formatListRecent('2026-10-22T03:00:00Z', { now: NOW })).toBe('木曜日')
    // 6日さかのぼると月曜
    expect(formatListRecent('2026-10-19T03:00:00Z', { now: NOW })).toBe('月曜日')
    // 7日さかのぼると今日と同じ曜日になり紛れるので日付
    expect(formatListRecent('2026-10-18T03:00:00Z', { now: NOW })).toBe('10/18')
    expect(formatListRecent('2026-10-17T03:00:00Z', { now: NOW })).toBe('10/17')
  })
  it('年が違えば年を付ける', () => {
    expect(formatListRecent('2025-12-31T03:00:00Z', { now: NOW })).toBe('2025/12/31')
  })
  it('時計のずれで未来になった時刻は日付で出す', () => {
    expect(formatListRecent('2026-10-25T09:30:00Z', { now: NOW })).toBe('10/25')
  })
  it('時刻が無い・壊れているときは代わりの印', () => {
    expect(formatListRecent(null, { now: NOW })).toBe('—')
    expect(formatListRecent('invalid', { now: NOW })).toBe('—')
  })
  it('全文は年月日と時刻、近い時は何分前かも付ける', () => {
    expect(formatListRecentTitle('2026-10-25T08:48:00Z', { now: NOW })).toBe('2026年10月25日 17:48（3分前）')
    expect(formatListRecentTitle('2026-10-17T03:00:00Z', { now: NOW })).toBe('2026年10月17日 12:00')
    expect(formatListRecentTitle(null, { now: NOW })).toBe('')
  })
})
