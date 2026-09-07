import { describe, expect, it } from 'vitest'

import { csvCell } from './csv'

describe('実行結果のCSV書き出し', () => {
  it('ふつうの文字はそのまま包む', () => {
    expect(csvCell('Kenta Kawano')).toBe('"Kenta Kawano"')
    expect(csvCell('')).toBe('""')
  })

  it('中の " は2つに増やす', () => {
    expect(csvCell('「特典」と書いた')).toBe('"「特典」と書いた"')
    expect(csvCell('a"b')).toBe('"a""b"')
  })

  it('先頭が = + - @ タブのときは \' を付けて式にしない', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"')
    expect(csvCell('+120')).toBe(`"'+120"`)
    expect(csvCell('-5')).toBe('"\'-5"')
    expect(csvCell('@sum')).toBe('"\'@sum"')
    expect(csvCell('\tINDIRECT')).toBe('"\'\tINDIRECT"')
  })

  it('先頭以外ならそのままにする', () => {
    expect(csvCell('a=b')).toBe('"a=b"')
  })
})
