import { expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { phoneReservationFailure } from './phone-error'

it('本文の言葉でなくサーバーのコードから次の操作を伝える', () => {
  expect(phoneReservationFailure(new ApiError(409, 'x', 'opening_hours_unconfigured'), 'owner')).toContain('営業時間が未設定')
  expect(phoneReservationFailure(new ApiError(409, 'x', 'opening_hours_unconfigured'), 'staff')).toContain('管理者に営業時間の設定を依頼')
  expect(phoneReservationFailure(new ApiError(409, 'x', 'reservation_time_past'))).toContain('日時を選び直して')
  expect(phoneReservationFailure(new ApiError(409, '営業時間が未設定', 'unrelated'))).toBeNull()
})
