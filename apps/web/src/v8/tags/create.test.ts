import { describe, expect, it } from 'vitest'
import { tagNameProblem } from './create'

describe('タグを作る（d9xoI）の作る前の検査', () => {
  it('空・81文字・制御文字は止め、ふつうの名前は通す', () => {
    expect(tagNameProblem('  ')).toBe('タグ名を入力してください')
    expect(tagNameProblem('あ'.repeat(81))).toBe('タグ名は80文字までで入力してください')
    expect(tagNameProblem('定期\u0007購入者')).toBe('タグ名に使えない文字が含まれています')
    expect(tagNameProblem('定期購入者')).toBeNull()
  })
})
