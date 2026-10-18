import { expect, it } from 'vitest'
import { approvedText } from './detail/detail-model'
import { formatStartsAtForStore, renderNotificationText } from '../../../../../worker/src/services/booking-notifier'
it('承認の確認文は実際の通知を組み立てる関数と同じ内容になる', () => {
  const start = '2026-10-18T01:15:00Z'
  const actual = renderNotificationText('approved', { menuName: '相談', staffName: '担当者', startsAt: formatStartsAtForStore(start, 'Asia/Tokyo'), daysUntil: 1, hoursUntil: 24 })
  expect(approvedText({ menu_name: '相談', staff_name: '担当者', starts_at: start })).toBe(actual)
})
