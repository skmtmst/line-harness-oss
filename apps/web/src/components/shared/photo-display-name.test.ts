import { describe, expect, it } from 'vitest'
import { photoPetDisplayName } from './photo-display-name'

describe('写真に出すペット名', () => {
  it('敬称を補い、すでにある敬称は重ねない', () => {
    expect(photoPetDisplayName('もも')).toBe('ももちゃん')
    expect(photoPetDisplayName('ももちゃん')).toBe('ももちゃん')
  })

  it('画面固有の見た目を保つときは敬称と欠損時表示を指定できる', () => {
    expect(photoPetDisplayName('もも', { honorific: false })).toBe('もも')
    expect(photoPetDisplayName(null, { fallback: '未取得', honorific: false })).toBe('未取得')
  })
})
