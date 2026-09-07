import { describe, expect, it } from 'vitest'
import { csvCell, formatJstDateTime, localDateTime, utcDateTime } from './presentation'

describe('presentation helpers', () => {
  it('CSV式を文字列として扱い、引用符を逃がす', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"')
    expect(csvCell('a,"b"')).toBe('"a,""b"""')
  })

  it('日時の欠落と不正値を推測しない', () => {
    expect(formatJstDateTime(null)).toBe('—')
    expect(formatJstDateTime('invalid')).toBe('—')
    expect(localDateTime('invalid')).toBe('')
    expect(utcDateTime('invalid')).toBeNull()
  })
})
