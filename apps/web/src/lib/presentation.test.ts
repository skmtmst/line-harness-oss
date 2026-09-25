import { describe, expect, it } from 'vitest'
import { csvCell, formatJstDateTime, localDateTime, tagTextColor, utcDateTime } from './presentation'

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** 白地との比。タグの札の地はほぼ白なので、白で割り直す。 */
function ratioOnWhite(hex: string): number {
  return 1.05 / (luminance(hex.replace('#', '')) + 0.05)
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
    expect(localDateTime('invalid')).toBe('')
    expect(utcDateTime('invalid')).toBeNull()
  })

  it('タグの文字色は白地で 4.5:1 以上になる濃さ', () => {
    // 監査の実測：#8b938d は 2.78:1、#00a947 は 3.1:1 で読めない。
    for (const color of ['#8b938d', '#00a947', '#06c755', '#e5484d', '#7651c9']) {
      expect(ratioOnWhite(tagTextColor(color))).toBeGreaterThanOrEqual(4.5)
    }
    // 濃い色はそのまま（#7651c9 は 5.54:1）。
    expect(tagTextColor('#7651c9')).toBe('#7651c9')
    // 書けない値はそのまま返す。
    expect(tagTextColor('red')).toBe('red')
  })
})
