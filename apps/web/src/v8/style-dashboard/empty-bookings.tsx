'use client'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { lockUnless } from '@/components/shared/permission-lock'
import type { IndustryStyle, StyleToday } from './model'

/** 有効な予約の有無を、頭と本文で同じ判定にする。 */
export function bookingEmptyState(style: IndustryStyle, today: Pick<StyleToday, 'rows'>): 'no-bookings' | 'has-bookings' | null {
  if (!['salon', 'consult'].includes(style)) return null
  return today.rows.some(row => row.booking && row.live !== false) ? 'has-bookings' : 'no-bookings'
}

/** 今日の空状態を一覧・盤・日カレンダーで共用する。 */
export function EmptyBookings({ style, today, canWrite, role, onBook, day = '今日' }: {
  day?: '今日' | 'この日'
  style: IndustryStyle
  today: Pick<StyleToday, 'rows'>
  canWrite: boolean
  role: string | null
  onBook: () => void
}) {
  if (bookingEmptyState(style, today) !== 'no-bookings') return null
  return <ListState kind="empty" title={`${day}の予約はありません`} description={today.rows.length ? '取消などの記録は下で確認できます。空いている時間に予約を入れられます。' : '空いている時間に予約を入れられます。'}
    action={<Button variant="primary" disabled={role === null} lockedReason={role === null ? undefined : lockUnless(canWrite)}
      onClick={() => { if (canWrite) onBook() }}>予約を入れる</Button>} />
}
