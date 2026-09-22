import { describe, expect, it } from 'vitest'
import { COMMON_VAR_VALUE_REQUIRED, commonVarValueError } from './common-vars'

/*
 * VAR-06: 新規・編集・代替値・更新予約の送信前検査。
 * 判定は worker の normalizeCommonVarValue（packages/db/src/common-vars.ts）
 * と同じ条件——画面で先に止めて理由を出し、400の「保存に失敗しました」に
 * 置き換わらないようにする。
 */
describe('commonVarValueError（送信前の型検査）', () => {
  it('空欄不可の種別は空を理由つきで止める', () => {
    expect(COMMON_VAR_VALUE_REQUIRED.has('boolean')).toBe(true)
    expect(COMMON_VAR_VALUE_REQUIRED.has('date')).toBe(true)
    expect(COMMON_VAR_VALUE_REQUIRED.has('datetime')).toBe(true)
    // 空欄を許す種別は必須にしない（「空のまま」絞り込みが存在するため）。
    expect(COMMON_VAR_VALUE_REQUIRED.has('text')).toBe(false)
    expect(COMMON_VAR_VALUE_REQUIRED.has('number')).toBe(false)
    expect(COMMON_VAR_VALUE_REQUIRED.has('image')).toBe(false)

    expect(commonVarValueError('boolean', '')).toBe('値を選んでください')
    expect(commonVarValueError('date', '')).toBe('値の日付を入力してください')
    expect(commonVarValueError('datetime', '')).toBe('値の日時を入力してください')
  })

  it('型に合う値は通し、合わない値は理由を返す', () => {
    expect(commonVarValueError('boolean', 'true')).toBeNull()
    expect(commonVarValueError('boolean', 'false')).toBeNull()
    expect(commonVarValueError('boolean', 'yes')).toBe('値は種別に合う値を入力してください')
    expect(commonVarValueError('date', '2028-02-29')).toBeNull()
    expect(commonVarValueError('date', '2026-02-30')).toContain('実在する日付')
    expect(commonVarValueError('datetime', '2028-02-29T23:59')).toBeNull()
    expect(commonVarValueError('datetime', '2026-02-30T24:00')).toContain('実在する日時')
  })

  it('画像は https URL だけを受ける（VAR-03）', () => {
    expect(commonVarValueError('image', '')).toBeNull()
    expect(commonVarValueError('image', 'https://cdn.example.com/logo.png')).toBeNull()
    expect(commonVarValueError('image', 'not-an-image')).toContain('https://')
    expect(commonVarValueError('image', 'http://example.com/a.png')).toContain('https://')
  })

  it('代替値・更新後の値では呼び名を変えて同じ判定をする', () => {
    expect(commonVarValueError('boolean', 'yes', '代替値'))
      .toBe('代替値は種別に合う値を入力してください')
    expect(commonVarValueError('datetime', '', '更新後の値'))
      .toBe('更新後の値の日時を入力してください')
  })

  it('文字数の上限はサーバと同じ（標準200・長文10,000）', () => {
    expect(commonVarValueError('text', 'あ'.repeat(200))).toBeNull()
    expect(commonVarValueError('text', 'あ'.repeat(201))).toContain('200文字')
    expect(commonVarValueError('long_text', 'あ'.repeat(10_000))).toBeNull()
    expect(commonVarValueError('long_text', 'あ'.repeat(10_001))).toContain('10,000文字')
  })
})
