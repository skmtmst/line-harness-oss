'use client'

/* 予約タブ。回数券・月謝（ 追記：店が手で入れる）と、この友だちの予約への行き先。 */
import { CalendarDays } from 'lucide-react'
import EmptyTab from './empty-tab'
import EntitlementsCard from './entitlements'
import styles from './entitlements.module.css'

export default function BookingsTab({ accountId, friendId, friendName, canEdit }: { accountId: string | null; friendId: string; friendName: string; canEdit: boolean }) {
  return (
    <div className={styles.bookingsStack}>
      <EntitlementsCard accountId={accountId} friendId={friendId} friendName={friendName} canEdit={canEdit} />
      <EmptyTab
        icon={<CalendarDays size={17} />}
        title="この友だちの予約だけを集めた画面はまだありません"
        text="予約の一覧からはこの人の予約を探せます。"
        actions={[{ label: '予約一覧を見る ↗', href: '/booking/bookings' }]}
      />
    </div>
  )
}
