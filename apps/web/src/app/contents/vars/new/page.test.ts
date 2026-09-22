import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('共通情報の新規作成', () => {
  it('社内メモを入力して既存の登録APIへ渡す', () => {
    expect(PAGE).toContain('const [memo, setMemo]')
    expect(PAGE).toContain('id="cv-memo"')
    expect(PAGE).toContain('memo,')
    expect(PAGE).toContain('api.commonVars.create(payload)')
  })

  it('入力前の注意と送信前警告から入力へ戻る操作を持つ', () => {
    expect(PAGE.indexOf('秘密値は保存しないでください')).toBeLessThan(PAGE.indexOf('id="cv-name"'))
    expect(PAGE).toContain('sensitiveFieldLabels(value, memo)')
    expect(PAGE).toContain('role="alertdialog"')
    expect(PAGE).toContain('入力に戻って修正する')
    expect(PAGE).toContain("valueRef.current?.focus()")
  })

  it('VAR-06: 型別の入力エラーを「保存に失敗しました」で隠さない', () => {
    // 送信前の型検査（真偽・年月日・日時・代替値）と、400/409/422の理由表示。
    expect(PAGE).toContain('commonVarValueError(type, value)')
    expect(PAGE).toContain("commonVarValueError(type, fallbackValue, '代替値')")
    expect(PAGE).toContain('describeSaveFailure(e)')
    expect(PAGE).toContain('focusTargetForReason')
    expect(PAGE).not.toContain('保存に失敗しました')
    // 空欄不可の種別は値の欄に必須の印を付ける。
    expect(PAGE).toContain('COMMON_VAR_VALUE_REQUIRED.has(type)')
    // 重複キー(409)の既存案内は退行させない。
    expect(PAGE).toContain('その差し込み名は既に使われています')
  })
})
