import { describe, expect, it } from 'vitest'
// @ts-expect-error CLIの.mjsには宣言ファイルが無い
import { titleFullyReadable, titlePasses } from './title-audit.mjs'

const title = {
  text: '長い配信の名前', title: '長い配信の名前',
  size: '22px', weight: '700', lh: '32px',
  whiteSpace: 'normal', textOverflow: 'clip',
  clientWidth: 200, scrollWidth: 200, clientHeight: 64, scrollHeight: 64,
}

describe('B-152⑩の題の全文確認', () => {
  it('切れずに折り返した題を許す', () => {
    expect(titleFullyReadable({ ...title, title: null })).toBe(true)
  })
  it('横または縦に切れた題を止める', () => {
    expect(titleFullyReadable({ ...title, scrollWidth: 220 })).toBe(false)
    expect(titleFullyReadable({ ...title, clientHeight: 32 })).toBe(false)
  })
  it('1行で省略する題は全文の手掛かりがあるときだけ許す', () => {
    const truncated = { ...title, whiteSpace: 'nowrap', textOverflow: 'ellipsis', scrollWidth: 300 }
    expect(titleFullyReadable(truncated)).toBe(true)
    expect(titleFullyReadable({ ...truncated, title: null })).toBe(false)
    expect(titleFullyReadable({ ...truncated, title: '途中' })).toBe(false)
    expect(titleFullyReadable({ ...truncated, textOverflow: 'clip' })).toBe(false)
  })
  it('空や測定できない題を通さない', () => {
    expect(titleFullyReadable(null)).toBe(false)
    expect(titleFullyReadable({ ...title, text: '' })).toBe(false)
    expect(titleFullyReadable({ ...title, clientWidth: 0 })).toBe(false)
  })
  it('全文が読めても文字の段が違えば寸法検査は止まる', () => {
    expect(titlePasses(title)).toBe(true)
    expect(titlePasses({ ...title, size: '20px' })).toBe(false)
    expect(titlePasses({ ...title, weight: '600' })).toBe(false)
    expect(titlePasses({ ...title, lh: '30px' })).toBe(false)
  })
})
