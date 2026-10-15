'use client'

import type { ReactNode } from 'react'
import { CalendarDays, CalendarPlus, CalendarX, CircleAlert } from 'lucide-react'
import { BookingPage } from '@/components/templates/booking-page'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Button from '@/components/shared/button'
import Card, { CardHeader, CardContent } from '@/components/shared/card'
import Avatar from '@/components/shared/avatar'
import ListState from '@/components/shared/list-state'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { ReservationFacts } from '@/components/shared/reservation-board'
import { formatDay, formatNumber, formatTime } from '@/lib/format'
import { jstDate } from '@/lib/jst-datetime'
import type { BookingRequest } from '@/lib/api'
import styles from './day-frame.module.css'

type Availability = { status: 'loading' | 'ready' | 'error' | 'unconfigured'; slots: { staffId: string; date: string; start: string; remaining: number; state: string }[] }
export function dayBookingSummary(rows: BookingRequest[], date: string, availability: Availability) {
  const active = rows.filter(row => !['cancelled', 'rejected', 'expired'].includes(row.status))
  const line = active.filter(row => row.source ? row.source === 'liff' : Boolean(row.friend_id)).length
  const slots = availability.slots.filter(slot => slot.date === date && slot.remaining > 0 && ['available', 'limited'].includes(slot.state))
  return { active: active.length, line, phone: active.length - line, requested: active.filter(row => row.status === 'requested').length,
    cancelled: rows.filter(row => ['cancelled', 'rejected', 'no_show'].includes(row.status)).length,
    sales: active.reduce((sum, row) => sum + row.price_at_booking, 0),
    available: availability.status === 'ready' ? new Set(slots.map(slot => `${slot.staffId}/${slot.start}`)).size : null,
    next: active.filter(row => ['requested', 'confirmed'].includes(row.status) && Date.parse(row.ends_at) > Date.now()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] }
}

export default function PeopleDayFrame({ view, date, rows, ready, availability, actions, canWrite, onOpen, children }: {
  view: 'day' | 'week'; date: string; rows: BookingRequest[]; ready: boolean; availability: Availability
  actions: ReactNode; canWrite: boolean; onOpen: (id: string) => void; children: ReactNode
}) {
  if (view === 'week') return <BookingPage title="予約管理" actions={actions}>{children}</BookingPage>
  const summary = dayBookingSummary(rows, date, availability)
  const value = (count: number) => ready ? count : null
  const next = ready ? summary.next : undefined
  const day = formatDay(`${date}T00:00:00+09:00`)
  const period = date === jstDate() ? '今日' : day
  const stats = <KpiBand layout="booking">
    <KpiCard presentation="band" icon={<CalendarDays size={16} aria-hidden />} title={`${period}の予約`} value={value(summary.active)} unit="件" detail={ready ? `LINE ${summary.line}・電話 ${summary.phone}` : '読み込んでいます'} />
    <KpiCard presentation="band" icon={<CalendarPlus size={16} aria-hidden />} title="まだ空いている枠" value={summary.available} unit="枠" detail={availability.status === 'ready' ? 'この日の残り' : availability.status === 'error' ? '読み込めませんでした' : availability.status === 'unconfigured' ? '受付枠が未設定' : '読み込んでいます'} help="空き枠から担当と開始時刻の重複を除いて数えています。メニュー違いの同じ枠は1枠です。" helpDisplay="question" />
    <KpiCard presentation="band" icon={<CircleAlert size={16} aria-hidden />} title="未承認・要対応" value={value(summary.requested)} unit="件" detail="承認待ちの予約" />
    <KpiCard presentation="band" icon={<CalendarX size={16} aria-hidden />} title="キャンセル" value={value(summary.cancelled)} unit="件" detail="この日" />
  </KpiBand>
  const aside = <>
    <section className={styles.section}>
      <h3>次の予約</h3>
      {next ? <Card frame="inset" padding="compact" layout="vertical" gap="tight">
        <CardHeader size="panel" title={next.friend_name ?? '名前の登録なし'} meta={next.menu_name} action={<Avatar name={next.friend_name} size={32} />} />
        <CardContent><ReservationFacts items={[{ label: '日付', value: day }, { label: '時刻', value: `${formatTime(next.starts_at)}〜${formatTime(next.ends_at)}` }, { label: '担当', value: next.staff_name }]} /></CardContent>
        <Button variant="primary" onClick={() => onOpen(next.id)}>詳細を見る</Button>
        {canWrite ? <Button href={`/booking/bookings/detail?id=${encodeURIComponent(next.id)}`}>日時を変える</Button> : null}
      </Card> : <ListState kind="empty" title={ready ? '次の予約はありません' : '予約を読み込んでいます'} />}
    </section>
    <section className={styles.section}><h3>気をつけること</h3><p>{!ready ? '読み込んでいます' : summary.requested ? `未承認の予約が${summary.requested}件あります。` : 'いま確認が必要な予約はありません。'}</p>{ready && summary.phone > 0 ? <p>LINE以外の予約は、連絡方法も確認してください。</p> : null}</section>
    <section className={styles.section}><h3>{day}の内訳</h3><ReservationFacts items={[
      { label: '予約', value: ready ? `${summary.active}件` : '—' }, { label: 'うちLINEから', value: ready ? `${summary.line}件` : '—' },
      { label: 'うち電話', value: ready ? `${summary.phone}件` : '—' }, { label: '売上見込み', value: ready ? `¥${formatNumber(summary.sales)}` : '—' },
    ]} /></section>
    <section className={styles.section}><h3>つながる先</h3><Button variant="text" href="/booking/menus">予約設定</Button><Button variant="text" href="/reminders">リマインダ</Button><Button variant="text" href="/friends">友だち</Button><Button variant="text" href="/conversions">コンバージョン</Button></section>
  </>
  return <BookingPage title="予約管理" help="担当者ごとの予約と空き枠を確認できます。" actions={actions} stats={stats} aside={aside}>
    {!canWrite ? <ReadOnlyNotice /> : null}{children}
  </BookingPage>
}
