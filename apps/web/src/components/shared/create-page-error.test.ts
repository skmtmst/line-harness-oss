import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { createPageErrorMessage, createPageReturnHref } from './create-page'

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

/*
 * MILEAGE-09: 保存後の戻り先。親URLが `/mileage?tab=earning-rules` のように
 * クエリを持っていても `?` を増やさず、タブを保ったまま新しい行を目立たせる。
 */
describe('CreatePage の戻り先URL（highlight）', () => {
  it('クエリを持たない親URLには ?highlight= を足す', () => {
    expect(createPageReturnHref('/webhooks', 'wh-1')).toBe('/webhooks?highlight=wh-1')
  })

  it('クエリを持つ親URLには &highlight= を足し、既存の指定を保つ', () => {
    expect(createPageReturnHref('/mileage?tab=earning-rules', 'rule-9'))
      .toBe('/mileage?tab=earning-rules&highlight=rule-9')
  })

  it('複数クエリ・ハッシュを持つ親URLでも、既存分を全部保つ', () => {
    expect(createPageReturnHref('/list?tab=a&filter=on#section-2', 'id-3'))
      .toBe('/list?tab=a&filter=on&highlight=id-3#section-2')
  })

  it('既に highlight が付いていれば重ねず書き換える', () => {
    expect(createPageReturnHref('/mileage?tab=earning-rules&highlight=old', 'new'))
      .toBe('/mileage?tab=earning-rules&highlight=new')
  })

  it('IDに予約文字があっても、壊れたURLを作らない', () => {
    const href = createPageReturnHref('/mileage?tab=earning-rules', 'a?b&c')
    expect(href.startsWith('/mileage?')).toBe(true)
    // '?' は1つだけ。2つ並ぶと tab 指定ごと読めなくなる。
    expect(href.split('?')).toHaveLength(2)
    expect(new URL(href, 'https://x.invalid').searchParams.get('highlight')).toBe('a?b&c')
  })

  it('IDが無ければ親URLへそのまま戻る', () => {
    expect(createPageReturnHref('/mileage?tab=earning-rules', undefined))
      .toBe('/mileage?tab=earning-rules')
  })
})
