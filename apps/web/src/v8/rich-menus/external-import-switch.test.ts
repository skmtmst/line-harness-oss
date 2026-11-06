/*
 * 監査 WEB221：取り込める LINE のメニューの行で、切り替えがある面を「切替なし」と言わない。
 */
import { describe, expect, it } from 'vitest'
import { switchText } from './external-import'

describe('取り込む前の行の「切替」（WEB221）', () => {
  it('面の動きに切り替えがあれば「切替あり」', () => {
    expect(switchText({ areas: [{ action: { type: 'richmenuswitch', supported: true } }] } as never)).toBe('切替あり')
  })
  it('面の動きが読めていなければ言い切らない', () => {
    expect(switchText({ areas: undefined } as never)).toBe('切替は未確認')
  })
  it('切り替えが無ければ「切替なし」（対照）', () => {
    expect(switchText({ areas: [{ action: { type: 'uri', supported: true } }] } as never)).toBe('切替なし')
  })
})
