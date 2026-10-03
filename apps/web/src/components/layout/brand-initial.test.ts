import { describe, it, expect } from 'vitest'
import { brandInitial } from './brand-initial'

/*
 * アイコンの1文字は、どの契約先でもその会社の名前から出す。
 * 以前は 1 社の名前を直接書いていたので、別の会社では法人格の
 * 「株」が出ていた（#1190）。
 */
describe('アイコンに出す会社名の1文字', () => {
  it('頭の法人格を外してから1文字目を取る', () => {
    expect(brandInitial('株式会社 然')).toBe('然')
    expect(brandInitial('株式会社むすび')).toBe('む')
    expect(brandInitial('一般社団法人 日本〇〇協会')).toBe('日')
    expect(brandInitial('合同会社テスト')).toBe('テ')
  })

  it('うしろに付く法人格も外す', () => {
    expect(brandInitial('然 株式会社')).toBe('然')
    expect(brandInitial('むすび有限会社')).toBe('む')
  })

  it('法人格が付かない名前はそのまま1文字目', () => {
    expect(brandInitial('然-NEN-')).toBe('然')
    expect(brandInitial('  サンプル店  ')).toBe('サ')
  })

  it('法人格だけ・空のときは消さずに空で返す（空の丸にしない判断は呼ぶ側）', () => {
    expect(brandInitial('株式会社')).toBe('株')
    expect(brandInitial('')).toBe('')
    expect(brandInitial('   ')).toBe('')
  })

  it('絵文字や合成文字でも1文字として壊さない', () => {
    expect(brandInitial('🍣すし処')).toBe('🍣')
  })
})
