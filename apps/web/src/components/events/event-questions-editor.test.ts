import { describe, expect, it } from 'vitest'
import { parseEventQuestions } from './event-questions-editor'

describe('parseEventQuestions (#841)', () => {
  it('questions_json のJSON文字列を配列に戻す', () => {
    const raw = JSON.stringify([
      { id: 'q1', label: 'アレルギー', type: 'text', required: true, options: null },
    ])
    expect(parseEventQuestions(raw)).toEqual([
      { id: 'q1', label: 'アレルギー', type: 'text', required: true, options: null },
    ])
  })

  it('null・空文字・壊れたJSON・配列以外は空配列に落とす', () => {
    expect(parseEventQuestions(null)).toEqual([])
    expect(parseEventQuestions('')).toEqual([])
    expect(parseEventQuestions('{oops')).toEqual([])
    expect(parseEventQuestions('{"a":1}')).toEqual([])
  })

  it('すでに配列ならそのまま返す', () => {
    const qs = [{ id: 'q1', label: 'X', type: 'text' as const, required: false }]
    expect(parseEventQuestions(qs)).toEqual(qs)
  })
})
