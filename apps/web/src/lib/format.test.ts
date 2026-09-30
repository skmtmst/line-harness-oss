import { describe, expect, it } from 'vitest'
import {
  formatBig,
  formatCount,
  formatDay,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPointDiff,
  formatRange,
  formatRelative,
  formatTime,
  formatYen,
} from './format'

// 2026-09-30 00:48 JST = 2026-09-29 15:48 UTC
const NOW = '2026-09-29T15:48:00Z'

describe('★V7 日付と数の書き方（板 ZzBqa §2）', () => {
  it('日時は今年なら M月D日（曜）H:mm、秒も年も出さない', () => {
    expect(formatDateTime('2026-09-29T15:48:00Z', '—', NOW)).toBe('9月30日（水）0:48')
    expect(formatDateTime('2026-09-29T15:48:59Z', '—', NOW)).toBe('9月30日（水）0:48')
  })

  it('年が違うときだけ頭に YYYY年 を付ける', () => {
    expect(formatDateTime('2025-04-03T01:00:00Z', '—', NOW)).toBe('2025年4月3日 10:00')
  })

  it('PCの地域に左右されない（UTC入力が必ずJSTで出る）', () => {
    expect(formatDateTime('2026-09-30T15:00:00Z', '—', NOW)).toBe('10月1日（木）0:00')
  })

  it('日付だけは M月D日（曜）', () => {
    expect(formatDay('2026-10-03T15:00:00Z', '—', NOW)).toBe('10月4日（日）')
    expect(formatDay('2025-04-03T01:00:00Z', '—', NOW)).toBe('2025年4月3日')
  })

  it('近い時刻: たった今・◯分前・◯時間前・昨日・◯日前・7日より前は日付', () => {
    expect(formatRelative('2026-09-29T15:48:00Z', NOW)).toBe('たった今')
    expect(formatRelative('2026-09-29T15:45:00Z', NOW)).toBe('3分前')
    expect(formatRelative('2026-09-29T10:48:00Z', NOW)).toBe('5時間前')
    // 昨日 18:02 JST = 2026-09-28 09:02 UTC
    expect(formatRelative('2026-09-28T15:10:00Z', NOW)).toBe('昨日 0:10')
    expect(formatRelative('2026-09-26T15:48:00Z', NOW)).toBe('3日前')
    expect(formatRelative('2026-09-20T15:48:00Z', NOW)).toBe('9月21日（月）')
  })

  it('期間は同じ月なら後ろの月を省く', () => {
    expect(formatRange('2026-09-01', '2026-09-30')).toBe('9月1日〜9月30日')
    expect(formatRange('2026-09-28', '2026-10-03')).toBe('9月28日〜10月3日')
  })

  it('件数・人数は3桁カンマ＋単位、0は「0件」', () => {
    expect(formatCount(12480, '人')).toBe('12,480人')
    expect(formatCount(3, '件')).toBe('3件')
    expect(formatCount(0, '件')).toBe('0件')
  })

  it('大きな数は1万2千以上で △△万（目盛り用）', () => {
    expect(formatBig(11999)).toBe('11,999')
    expect(formatBig(12480)).toBe('1.2万')
    expect(formatBig(20000)).toBe('2万')
    expect(formatBig(125000)).toBe('12.5万')
  })

  it('割合は小数1桁、差はpt', () => {
    expect(formatPercent(48.2)).toBe('48.2%')
    expect(formatPercent(48)).toBe('48.0%')
    expect(formatPointDiff(-1.1)).toBe('-1.1pt')
    expect(formatPointDiff(2)).toBe('+2.0pt')
  })

  it('お金は ¥＋3桁カンマ', () => {
    expect(formatYen(12400)).toBe('¥12,400')
    expect(formatYen(0)).toBe('¥0')
  })

  it('読めない値はフォールバック、numberは有限だけ', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('not-a-date', '?')).toBe('?')
    expect(formatNumber(NaN)).toBe('—')
    expect(formatRelative(undefined, NOW, '未実施')).toBe('未実施')
  })

  it('formatTime は秒を出さない', () => {
    expect(formatTime('2026-09-29T15:48:59Z')).toBe('0:48')
  })
})
