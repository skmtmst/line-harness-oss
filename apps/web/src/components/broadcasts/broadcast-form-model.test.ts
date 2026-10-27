import { describe, expect, it } from 'vitest'
import { TYPE_LABELS, typeLabel } from './broadcast-form-model'

describe('メッセージの種類の呼び名', () => {
  it('知っている種類は画面の呼び名で出す', () => {
    expect(typeLabel('text')).toBe(TYPE_LABELS.text)
    expect(typeLabel('text')).not.toBe('text')
  })

  it('知らない種類でも、札に内部の語をそのまま出さない', () => {
    expect(typeLabel('legacy_unknown')).toBe('その他')
    expect(typeLabel('')).toBe('その他')
  })
})
