import { describe, expect, it } from 'vitest'
import { headCountLabel } from './nen-pets-api'

/*
 * 全ルート監査 A3（2026-09-25）: `/nen/pets`・`/nen/health` の件数が
 * 「0件中 0〜NaN件／頭」になっていた。0のときは範囲を付けず「0頭」だけ。
 */
describe('headCountLabel', () => {
  it('0のときは範囲を付けない', () => {
    expect(headCountLabel(0, 1, 20)).toBe('0頭')
  })

  it('1件以上は「全体 始め〜終わり」の形', () => {
    expect(headCountLabel(2, 1, 20)).toBe('2頭中 1〜2頭')
    expect(headCountLabel(45, 3, 20)).toBe('45頭中 41〜45頭')
  })
})
