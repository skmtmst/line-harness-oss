import { describe, expect, it } from 'vitest'
import { csvCell, formatJstDateTime, localDateTime, tagBadgeBackground, tagTextColor, utcDateTime } from './presentation'

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/**
 * 実際の札の下地との比。白で割り直すと足りない。下地自体が同じ色の
 * 薄色なので、白で 4.5 を満たしても札の上では 4.1 前後まで落ちる
 * （2026-09-25・/inflow-links の axe 指摘）。
 */
function ratioOnBadge(text: string, color: string): number {
  const foreground = luminance(text.replace('#', ''))
  const background = luminance(tagBadgeBackground(color).replace('#', ''))
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
}

describe('presentation helpers', () => {
  it('CSV式を文字列として扱い、引用符を逃がす', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"')
    expect(csvCell('a,"b"')).toBe('"a,""b"""')
  })

  it('先頭が式になり得る文字（=+-@・タブ・改行復帰）を無効化する', () => {
    // #999 DEEP-25: DDEペイロード形式の先頭文字をエスケープする。
    expect(csvCell('=cmd|\'/C1 calc\'!A0')).toBe('"\'=cmd|\'/C1 calc\'!A0"')
    expect(csvCell('+120')).toBe('"\'+120"')
    expect(csvCell('-5')).toBe('"\'-5"')
    expect(csvCell('@sum')).toBe('"\'@sum"')
    expect(csvCell('\tINDIRECT("x")')).toBe('"\'\tINDIRECT(""x"")"')
    // 文中の = は式にならないのでそのまま
    expect(csvCell('a=b')).toBe('"a=b"')
    // null/undefined は空セル
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })

  it('日時の欠落と不正値を推測しない', () => {
    expect(formatJstDateTime(null)).toBe('—')
    expect(formatJstDateTime('invalid')).toBe('—')
    expect(formatJstDateTime('invalid', '未設定')).toBe('未設定')
    expect(localDateTime('invalid')).toBe('')
    expect(utcDateTime('invalid')).toBeNull()
  })

  it('UTC保存値はオフセットの有無にかかわらず、日本時間の同じ日付に表示する', () => {
    const original = process.env.TZ
    try {
      for (const timeZone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = timeZone
        const expected = formatJstDateTime('2026-10-17T15:30:00Z')
        expect(expected).toContain('10月18日（日）00:30')
        expect(formatJstDateTime('2026-10-17 15:30:00')).toBe(expected)
        expect(formatJstDateTime('2026-10-17T15:30:00')).toBe(expected)
        expect(formatJstDateTime('2026-10-18T00:30:00+09:00')).toBe(expected)
      }
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  it('タグの文字色は札の下地で 4.5:1 以上になる濃さ', () => {
    // 監査の実測：#8b938d は 2.78:1、#00a947 は 3.1:1 で読めない。
    // 撮影の札の色でも札の上で 4.5 を割らないこと。
    for (const color of ['#8b938d', '#00a947', '#06c755', '#e5484d', '#7651c9', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6']) {
      expect(ratioOnBadge(tagTextColor(color), color)).toBeGreaterThanOrEqual(4.5)
    }
    // 濃い色はそのまま（#7651c9 は札の上で 4.62:1）。
    expect(tagTextColor('#7651c9')).toBe('#7651c9')
    // 書けない値はそのまま返す。
    expect(tagTextColor('red')).toBe('red')
  })
})
