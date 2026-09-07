import { describe, expect, it } from 'vitest'
import { bookingMenuBaseError } from './menu-validation'

describe('予約メニューの基本入力', () => {
  it('正常な値を受け付ける', () => {
    expect(bookingMenuBaseError({
      name: ' 相談 ', durationMinutes: 60, bufferAfterMinutes: 10, sortOrder: 0,
    })).toBeNull()
  })

  it.each([
    [{ name: ' ', durationMinutes: 60 }, 'メニュー名'],
    [{ name: 'a'.repeat(201), durationMinutes: 60 }, 'メニュー名'],
    [{ name: '相談', durationMinutes: 0 }, '所要時間'],
    [{ name: '相談', durationMinutes: 60, bufferAfterMinutes: -1 }, '後の空き時間'],
    [{ name: '相談', durationMinutes: 60, sortOrder: -1 }, '並び順'],
  ])('不正値 %o を保存前に拒否する', (draft, message) => {
    expect(bookingMenuBaseError(draft)).toContain(message)
  })
})
