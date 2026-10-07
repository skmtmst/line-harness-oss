'use client'

/* 予約タブ。この友だちの予約だけを集めた画面はまだ無い。 */
import { CalendarDays } from 'lucide-react'
import EmptyTab from './empty-tab'

export default function BookingsTab() {
  return (
    <EmptyTab
      icon={<CalendarDays size={17} />}
      title="この友だちの予約だけを集めた画面はまだありません"
      text="予約の一覧からはこの人の予約を探せます。"
      actions={[{ label: '予約一覧を見る ↗', href: '/booking/bookings' }]}
    />
  )
}
