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
})
