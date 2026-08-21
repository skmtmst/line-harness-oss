/*
 * 日付の差し込み。
 *
 * ここがずれると、**相手に届いた文面が間違う**。しかも配信は自動なので、
 * 気づくのは受け取った人からの指摘になる。日付をまたぐ時刻と、
 * 実行環境の時計に引きずられないことを重点的に見る。
 */
import { describe, it, expect } from 'vitest'
import { formatDate, daysUntil, expandDateVariables, DATE_FORMATS } from './interpolation-date.js'

/** JST の日時を UTC の Date として作る。 */
function jst(y: number, m: number, d: number, hh = 12, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm))
}

describe('書き方', () => {
  const at = jst(2026, 8, 20, 10)

  it('8通りすべて出せる', () => {
    expect(DATE_FORMATS).toHaveLength(8)
    for (const f of DATE_FORMATS) {
      expect(formatDate(at, f.value)).toBeTruthy()
    }
  })

  it('見本のとおりに出る', () => {
    expect(formatDate(at, 'md_w')).toBe('8月20日(木)')
    expect(formatDate(at, 'ymd_w')).toBe('2026年8月20日(木)')
    expect(formatDate(at, 'md')).toBe('8月20日')
    expect(formatDate(at, 'ymd')).toBe('2026年8月20日')
    expect(formatDate(at, 'slash_md_w')).toBe('8/20(木)')
    expect(formatDate(at, 'slash_ymd_w')).toBe('2026/8/20(木)')
    expect(formatDate(at, 'slash_md')).toBe('8/20')
    expect(formatDate(at, 'slash_ymd')).toBe('2026/8/20')
  })
})

describe('日本時間で数える', () => {
  it('JSTの深夜0時台でも、その日の日付になる', () => {
    // JST 8/20 00:30 は UTC では 8/19 15:30。UTCで数えると1日ずれる。
    expect(formatDate(jst(2026, 8, 20, 0, 30), 'md')).toBe('8月20日')
  })

  it('JSTの23時台でも、翌日にならない', () => {
    expect(formatDate(jst(2026, 8, 20, 23, 59), 'md')).toBe('8月20日')
  })
})

describe('カウントダウン', () => {
  it('残り日数を返す', () => {
    expect(daysUntil(jst(2026, 8, 20, 10), '2026-08-25')).toBe(5)
  })

  it('日付だけで数える（同じ日なら朝でも夜でも同じ）', () => {
    expect(daysUntil(jst(2026, 8, 20, 1), '2026-08-21')).toBe(1)
    expect(daysUntil(jst(2026, 8, 20, 23), '2026-08-21')).toBe(1)
  })

  it('当日は0', () => {
    expect(daysUntil(jst(2026, 8, 20, 10), '2026-08-20')).toBe(0)
  })

  it('過ぎていても負の数にしない', () => {
    expect(daysUntil(jst(2026, 8, 20, 10), '2026-08-01')).toBe(0)
  })

  it('月と年をまたいでも数えられる', () => {
    expect(daysUntil(jst(2026, 12, 25, 10), '2027-01-01')).toBe(7)
  })

  it('形が違えば null', () => {
    expect(daysUntil(jst(2026, 8, 20), '2026/08/25')).toBeNull()
    expect(daysUntil(jst(2026, 8, 20), 'あした')).toBeNull()
  })
})

describe('本文の置き換え', () => {
  const at = jst(2026, 8, 20, 10)

  it('配信日をそのまま出す', () => {
    expect(expandDateVariables('本日{{date}}のお知らせです', at)).toBe(
      '本日8月20日(木)のお知らせです',
    )
  })

  it('書き方を指定できる', () => {
    expect(expandDateVariables('{{date:slash_ymd}}', at)).toBe('2026/8/20')
  })

  it('何日後かを出せる', () => {
    expect(expandDateVariables('{{date+3}}', at)).toBe('8月23日(日)')
    expect(expandDateVariables('{{date+3:md}}', at)).toBe('8月23日')
  })

  it('前の日も出せる', () => {
    expect(expandDateVariables('{{date-1:md}}', at)).toBe('8月19日')
  })

  it('カウントダウンを出せる', () => {
    expect(expandDateVariables('あと{{days_until:2026-08-25}}日', at)).toBe('あと5日')
  })

  it('1つの本文に何個あっても置き換える', () => {
    expect(expandDateVariables('{{date:md}}から{{date+7:md}}まで', at)).toBe('8月20日から8月27日まで')
  })

  it('知らない書き方は既定で出す（差し込みを本文に残さない）', () => {
    // {{date:xxx}} がそのまま相手に届くのがいちばん困る。
    const out = expandDateVariables('{{date:xxx}}', at)
    expect(out).toBe('8月20日(木)')
    expect(out).not.toContain('{{')
  })

  it('差し込みが無い本文は変えない', () => {
    expect(expandDateVariables('ふつうの本文です', at)).toBe('ふつうの本文です')
  })

  it('他の差し込みを壊さない', () => {
    expect(expandDateVariables('{{name}}様 {{date:md}}', at)).toBe('{{name}}様 8月20日')
  })
})
