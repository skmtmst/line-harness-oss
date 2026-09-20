import { describe, expect, it } from 'vitest'
import { csvCell, formatJstDateTime, localDateTime, utcDateTime } from './presentation'

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
})
