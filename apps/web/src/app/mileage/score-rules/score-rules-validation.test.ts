import { describe, expect, it } from 'vitest'

import { validateRuleName, validateTestScore } from './score-rules-validation'

const BANDS = { min: 0, max: 100 }

describe('R302: 試算前の点数は空欄を受け付けない', () => {
  it('空欄と空白だけは必須エラーにする', () => {
    expect(validateTestScore('', BANDS)).toEqual({ ok: false, error: 'テストする点数を入力してください' })
    expect(validateTestScore('   ', BANDS)).toEqual({ ok: false, error: 'テストする点数を入力してください' })
  })

  it('明示した0は成功する', () => {
    expect(validateTestScore('0', BANDS)).toEqual({ ok: true, value: 0 })
  })

  it('範囲外・小数は既存の範囲エラーにする', () => {
    const message = 'テストする点数は0〜100の整数で入力してください'
    expect(validateTestScore('101', BANDS)).toEqual({ ok: false, error: message })
    expect(validateTestScore('1.5', BANDS)).toEqual({ ok: false, error: message })
    expect(validateTestScore('-1', BANDS)).toEqual({ ok: false, error: message })
    expect(validateTestScore('あ', BANDS)).toEqual({ ok: false, error: message })
  })

  it('前後の空白があっても中の整数は通す', () => {
    expect(validateTestScore(' 30 ', BANDS)).toEqual({ ok: true, value: 30 })
  })
})

describe('R303: ルールの表示名は空欄で追加しない', () => {
  it('空欄と空白だけはエラーにする', () => {
    expect(validateRuleName('')).toEqual({ ok: false, error: '表示名を入力してください' })
    expect(validateRuleName('   ')).toEqual({ ok: false, error: '表示名を入力してください' })
  })

  it('前後の空白を落として通す', () => {
    expect(validateRuleName('  返信した  ')).toEqual({ ok: true, value: '返信した' })
  })
})
