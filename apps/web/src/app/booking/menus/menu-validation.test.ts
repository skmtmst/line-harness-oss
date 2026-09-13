import { describe, expect, it } from 'vitest'
import { bookingMenuError } from './menu-validation'

describe('予約メニューの基本入力', () => {
  it('正常な値を受け付ける', () => {
    expect(bookingMenuError({
      name: ' 相談 ', durationMinutes: 60, bufferAfterMinutes: 10, sortOrder: 0, assignedStaffCount: 1,
    })).toBeNull()
  })

  it.each([
    [{ name: ' ', durationMinutes: 60, assignedStaffCount: 1 }, 'メニュー名'],
    [{ name: 'a'.repeat(201), durationMinutes: 60, assignedStaffCount: 1 }, 'メニュー名'],
    [{ name: '相談', durationMinutes: 0, assignedStaffCount: 1 }, '所要時間'],
    [{ name: '相談', durationMinutes: 60, bufferAfterMinutes: -1, assignedStaffCount: 1 }, '後の空き時間'],
    [{ name: '相談', durationMinutes: 60, sortOrder: -1, assignedStaffCount: 1 }, '並び順'],
    [{ name: '相談', durationMinutes: 60, assignedStaffCount: 0 }, '担当できる人'],
  ])('不正値 %o を保存前に拒否する', (draft, message) => {
    expect(bookingMenuError(draft)).toContain(message)
  })
})
