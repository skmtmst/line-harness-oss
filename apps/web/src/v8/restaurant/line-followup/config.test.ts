import { describe,it,expect } from 'vitest'
import { RESTAURANT_TRIGGER_ROWS,exactTiming,timingError,timingLabel } from './config'
describe('時期の言い方と検査', () => {
  it('7つの行の言い方が決まりどおり', () => {
    expect(timingLabel('reservation_created', 0)).toBe('予約が入ったらすぐ')
    expect(timingLabel('reservation_24h', -1440)).toBe('1日前')
    expect(timingLabel('reservation_2h', -120)).toBe('2時間前')
    expect(timingLabel('post_visit', 180)).toBe('退店から 3時間後')
    expect(timingLabel('review_request', 1440)).toBe('退店から 1日後')
    expect(timingLabel('waitlist_invited', 0)).toBe('空きが出たらすぐ')
    expect(timingLabel('anniversary_before', -10080)).toBe('記念日の7日前')
    expect(timingLabel('post_visit', null)).toBe('時期がまだありません')
  })
  it('鯖と同じ時期の規則（前なら負・後なら0以上）', () => {
    expect(timingError('reservation_24h', 60)).toContain('0より小さい')
    expect(timingError('post_visit', -1)).toContain('0以上')
    expect(timingError('reservation_24h', -1440)).toBeNull()
    expect(timingError('post_visit', 180)).toBeNull()
    expect(timingError('reservation_created', 0)).toBeNull()
    // 記念日前も、ほかの「前」と同じく負の時期を受け付ける。
    expect(timingError('anniversary_before', -10080)).toBeNull()
    expect(timingError('anniversary_before', 10080)).not.toBeNull()
  })
  it('行の定義は7つで飲食の順に並ぶ', () => {
    expect(RESTAURANT_TRIGGER_ROWS.map(row => row.trigger)).toEqual([
      'reservation_created', 'reservation_24h', 'reservation_2h', 'post_visit',
      'review_request', 'waitlist_invited', 'anniversary_before',
    ])
  })
  it('既存の時期は割り切れる一番大きい単位で正確に分ける', () => {
    expect(exactTiming(1440, ['minutes', 'hours', 'days'])).toEqual({ amount: '1', unit: 'days' })
    expect(exactTiming(180, ['minutes', 'hours', 'days'])).toEqual({ amount: '3', unit: 'hours' })
    expect(exactTiming(181, ['minutes', 'hours', 'days'])).toEqual({ amount: '181', unit: 'minutes' })
    expect(exactTiming(90, ['minutes', 'hours'])).toEqual({ amount: '90', unit: 'minutes' })
  })
})
