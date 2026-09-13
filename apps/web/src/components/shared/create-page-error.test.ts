import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { createPageErrorMessage } from './create-page'

describe('CreatePage error message', () => {
  it('APIが許可した案内はそのまま表示する', () => {
    expect(createPageErrorMessage(new ApiError(409, '最新の内容を確認してください')))
      .toBe('最新の内容を確認してください')
  })

  it('内部の英語エラーを運用者向けの日本語へ置き換える', () => {
    expect(createPageErrorMessage(new Error('conversion create failed')))
      .toBe('保存に失敗しました。入力内容を確認して、もう一度お試しください。')
  })
})
