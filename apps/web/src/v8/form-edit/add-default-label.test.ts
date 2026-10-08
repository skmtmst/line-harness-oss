/*
 * 足す欄（ADD_GROUPS）：メール・住所・日付・時刻・ファイルは、足したときに質問文にその名前が入っている
 * （オーナー 2026-10-08）。ほかの入力は今どおり空（質問の文を書いてもらう）。
 */
import { describe, expect, it } from 'vitest'
import { ADD_GROUPS } from './model'

const card = (key: string) => ADD_GROUPS.flatMap((group) => group.cards).find((item) => item.key === key)!
const labelOf = (key: string) => {
  const block = card(key).make(0)
  return block.kind === 'input' ? block.label : null
}

describe('足したときの質問文', () => {
  it('メール・住所・日付・時刻・ファイルは名前が入っている', () => {
    expect(labelOf('contact')).toBe('メールアドレス')
    expect(labelOf('address')).toBe('住所')
    expect(labelOf('date')).toBe('日付')
    expect(labelOf('time')).toBe('時刻')
    expect(labelOf('file')).toBe('ファイル')
  })

  it('形のチェック（メール・時刻）は今どおり', () => {
    const contact = card('contact').make(0)
    const time = card('time').make(0)
    expect(contact.kind === 'input' && contact.limit?.format).toBe('email')
    expect(time.kind === 'input' && time.limit?.format).toBe('time')
  })

  it('1行で書く・自由に書くは空のまま', () => {
    expect(labelOf('text')).toBe('')
    expect(labelOf('textarea')).toBe('')
  })
})
