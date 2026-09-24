import { describe, expect, it } from 'vitest'
import { photoPetDisplayName } from './photo-display-name'

describe('写真に出すペット名', () => {
  it('男の子はくん、女の子と未回答はちゃんで呼ぶ', () => {
    expect(photoPetDisplayName('そら', { gender: 'male' })).toBe('そらくん')
    expect(photoPetDisplayName('もも', { gender: 'female' })).toBe('ももちゃん')
    expect(photoPetDisplayName('むぎ')).toBe('むぎちゃん')
    expect(photoPetDisplayName('ももちゃん')).toBe('ももちゃん')
  })

  it('Worker が返した完成済みの呼び名を優先する', () => {
    expect(photoPetDisplayName('そら', { callName: 'そらくん', gender: 'female' })).toBe('そらくん')
  })

  it('画面固有の見た目を保つときは敬称と欠損時表示を指定できる', () => {
    expect(photoPetDisplayName('もも', { honorific: false })).toBe('もも')
    expect(photoPetDisplayName(null, { fallback: '未取得', honorific: false })).toBe('未取得')
  })
})
