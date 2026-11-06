import { expect, it } from 'vitest'
import { approvedText } from './detail/detail-model'
import { formatStartsAtForStore, renderNotificationText } from '../../../../../worker/src/features/booking/booking-notifier'
it('承認の確認文は実際の通知を組み立てる関数と同じ内容になる', () => {
  const start = '2026-10-18T01:15:00Z'
  const actual = renderNotificationText('approved', { menuName: '相談', staffName: '担当者', startsAt: formatStartsAtForStore(start, 'Asia/Tokyo'), daysUntil: 1, hoursUntil: 24 })
  expect(approvedText({ confirmationPreviewText: actual })).toBe(actual)
})

it.each([null, undefined, '', '  \n '])('本文が%jなら古い固定文で補わない', (confirmationPreviewText) => {
  expect(approvedText({ confirmationPreviewText })).toBeNull()
})
it('受け取った本文の空白や改行を変えない', () => {
  const text = '  お客様へのお知らせ\n\n日時: 2026-10-18 10:15\n'
  expect(approvedText({ confirmationPreviewText: text })).toBe(text)
})
