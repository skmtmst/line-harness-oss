import { describe, expect, it } from 'vitest'
import { BOOKING_EDIT_KEY, canOperateBookings } from './booking-permissions'

/**
 * 予約画面の操作ボタンを出すかの判定 (#933 N-401)。
 * 最終の可否はサーバの403が決める。ここは「押せる形を見せるか」だけ。
 */
describe('canOperateBookings (N-401)', () => {
  it('owner と admin は常に操作できる', () => {
    expect(canOperateBookings({ role: 'owner', permissionKeys: [] })).toBe(true)
    expect(canOperateBookings({ role: 'admin', permissionKeys: [] })).toBe(true)
  })

  it('staff は編集キー /booking/bookings を持つ人だけ操作できる', () => {
    expect(canOperateBookings({ role: 'staff', permissionKeys: [BOOKING_EDIT_KEY] })).toBe(true)
    expect(canOperateBookings({ role: 'staff', permissionKeys: ['/booking/menus'] })).toBe(false)
    expect(canOperateBookings({ role: 'staff', permissionKeys: [] })).toBe(false)
    expect(canOperateBookings({ role: 'staff', permissionKeys: null })).toBe(false)
  })

  it('viewer（閲覧のみ）は操作ボタンを出さない', () => {
    expect(canOperateBookings({ role: 'viewer', permissionKeys: [] })).toBe(false)
    expect(canOperateBookings({ role: 'viewer', permissionKeys: [BOOKING_EDIT_KEY] })).toBe(false)
  })

  it('権限が読み込めていない(null)間も操作ボタンを出さない', () => {
    // 権限のある人に一瞬見せて消すより、静かに出すほうが誤操作を防ぐ。
    expect(canOperateBookings(null)).toBe(false)
    expect(canOperateBookings(undefined)).toBe(false)
  })
})
