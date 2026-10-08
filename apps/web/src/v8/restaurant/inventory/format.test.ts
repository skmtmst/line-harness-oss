import { describe, expect, it } from 'vitest'
import { formatAt, formatTime, slotTimeLabel } from './format'
import { reservationLine } from '../tables/move'
import type { RestaurantReservation } from '@/lib/restaurant-test-api'

describe('飲食店の時刻表示', () => {
  it('端末の地域に依存せず店舗の時刻と日付を表示する', () => {
    const instant = '2026-10-09T10:00:00.000Z'
    expect(slotTimeLabel(instant, 'Asia/Tokyo')).toBe('19:00')
    expect(slotTimeLabel(instant, 'Asia/Ho_Chi_Minh')).toBe('17:00')
    expect(formatTime(instant, 'Asia/Tokyo')).toBe('19:00')
    expect(formatAt('2026-10-09T16:00:00.000Z', 'Asia/Tokyo')).toBe('10/10 01:00')
    expect(reservationLine({ starts_at: instant, customer_name: '予約の見本', guest_count: 4 } as RestaurantReservation, 'Asia/Tokyo')).toBe('10/9（金）19:00 予約の見本 4名')
  })
})
