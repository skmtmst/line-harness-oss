import { describe, expect, it } from 'vitest'
import { formatListRecent, formatListRecentTitle } from './format'

// 日曜の 17:51（日本時間）
const NOW = new Date('2026-10-25T08:51:00Z')

describe('受信箱一覧の時刻（24時間は相対表示、それより前は狭い列用）', () => {
  it('24時間以内は相対時刻', () => {
    expect(formatListRecent('2026-10-25T08:48:00Z', { now: NOW })).toBe('3分前')
    expect(formatListRecent('2026-10-24T15:05:00Z', { now: NOW })).toBe('17時間前')
    expect(formatListRecent('2026-10-24T14:30:00Z', { now: NOW })).toBe('18時間前')
    expect(formatListRecent('2026-10-24T08:51:00Z', { now: NOW })).toBe('24時間前')
    expect(formatListRecent('2026-10-24T08:50:59Z', { now: NOW })).toBe('10/24 17:50')
  })
  it('24時間超は月日・時刻。前年までは年を省き、さらに古い年は年を出す', () => {
    expect(formatListRecent('2026-10-22T03:00:00Z', { now: NOW })).toBe('10/22 12:00')
    expect(formatListRecent('2026-10-19T03:00:00Z', { now: NOW })).toBe('10/19 12:00')
    expect(formatListRecent('2026-10-18T03:00:00Z', { now: NOW })).toBe('10/18 12:00')
    expect(formatListRecent('2026-10-17T03:00:00Z', { now: NOW })).toBe('10/17 12:00')
  })
  it('今年と前年は年を省き、それより古い年には年を付ける', () => {
    expect(formatListRecent('2025-12-31T03:00:00Z', { now: NOW })).toBe('12/31 12:00')
    expect(formatListRecent('2024-12-31T03:00:00Z', { now: NOW })).toBe('2024/12/31 12:00')
  })
  it('時計のずれで未来になった時刻は日付と時刻で出す', () => {
    expect(formatListRecent('2026-10-25T09:30:00Z', { now: NOW })).toBe('10/25 18:30')
  })
  it('時刻が無い・壊れているときは代わりの印', () => {
    expect(formatListRecent(null, { now: NOW })).toBe('—')
    expect(formatListRecent('invalid', { now: NOW })).toBe('—')
  })
  it('全文も共通日時書式を使い、近い時は何分前かも付ける', () => {
    expect(formatListRecentTitle('2026-10-25T08:48:00Z', { now: NOW })).toBe('10月25日 17:48（3分前）')
    expect(formatListRecentTitle('2026-10-17T03:00:00Z', { now: NOW })).toBe('10月17日 12:00')
    expect(formatListRecentTitle('2024-10-17T03:00:00Z', { now: NOW })).toBe('2024年10月17日 12:00')
    expect(formatListRecentTitle(null, { now: NOW })).toBe('')
  })
})
