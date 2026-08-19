/*
 * 配信の本流で、日付の差し込みが実際に置き換わること。
 *
 * expandDateVariables 単体が正しくても、expandVariables から呼ばれて
 * いなければ相手には `{{date}}` がそのまま届く。**繋がっているか**を見る。
 *
 * あわせて、日付を先に処理していることも確かめる。友だち情報の値に
 * 偶然 `{{date}}` の形が入っていたとき、それが日付として解釈されると、
 * 利用者が入れた文字列を勝手に書き換えることになる。
 */
import { describe, it, expect } from 'vitest'
import { expandVariables } from './step-delivery.js'

const FRIEND = { id: 'f1', display_name: '山本', user_id: null, metadata: {} }

/** JST の日時を UTC の Date として作る。 */
function jst(y: number, m: number, d: number, hh = 12): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 9))
}

describe('配信時の日付の差し込み', () => {
  it('届く日付に置き換わる', () => {
    const out = expandVariables('{{name}}様、{{date}}にお届けします', FRIEND, undefined, 'text', {
      deliveredAt: jst(2026, 8, 20),
    })
    expect(out).toBe('山本様、8月20日(木)にお届けします')
  })

  it('カウントダウンも置き換わる', () => {
    const out = expandVariables('あと{{days_until:2026-08-25}}日', FRIEND, undefined, 'text', {
      deliveredAt: jst(2026, 8, 20),
    })
    expect(out).toBe('あと5日')
  })

  it('届く日時を渡さなければ「いま」で数える（テスト送信・プレビュー）', () => {
    const out = expandVariables('{{date:ymd}}', FRIEND, undefined, 'text', {})
    expect(out).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/)
    expect(out).not.toContain('{{')
  })

  it('友だち情報の値に入っていた文字列は、日付として解釈しない', () => {
    // 利用者が入れた値を勝手に書き換えてはいけない。
    const out = expandVariables('{{field.memo}}', FRIEND, undefined, 'text', {
      deliveredAt: jst(2026, 8, 20),
      fields: { memo: '{{date}}' },
    })
    expect(out).toBe('{{date}}')
  })

  it('これまでの差し込みを壊していない', () => {
    const out = expandVariables(
      '{{name}}様 {{field.pet}} {{var.shop}} {{date:md}}',
      FRIEND,
      undefined,
      'text',
      { deliveredAt: jst(2026, 8, 20), fields: { pet: 'ポチ' }, vars: { shop: '渋谷店' } },
    )
    expect(out).toBe('山本様 ポチ 渋谷店 8月20日')
  })
})
